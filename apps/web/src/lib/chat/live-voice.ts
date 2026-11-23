/**
 * Live (hands-free) voice conversation client (ADR-0027). No third-party libraries.
 *
 *   microphone → MediaRecorder (Opus, 250 ms slices) → POST /api/v1/voice/sessions/{sid}/audio
 *   GET /api/v1/voice/sessions/{sid}/events (SSE) → partial / end_of_turn / speech_started
 *
 * Everything goes through the BFF; the browser never sees a provider key. Chunks are sent one
 * at a time in order; a failed chunk is retried with the SAME `seq` (the server drops
 * duplicates), so a flaky network never duplicates or reorders audio. The event stream
 * reconnects with `after=<last event id>` so no transcript event is lost or applied twice, and
 * each `end_of_turn` is delivered once per turn index. Audio is never stored by the client.
 *
 * Echo (ADR-0033): while KAREN speaks, the microphone goes through a `DuplexGate` — silence is
 * recorded instead of her voice leaking back from the speakers (which would otherwise come back as
 * a "user" turn and make her talk to herself). The local microphone level is still measured, and
 * when the user clearly talks over her the gate opens and `onBargeIn` fires.
 *
 * The class has no React or DOM globals in its core: media, fetch and timers are injected so the
 * state machine is unit-testable.
 */
import type { VoiceEvent, VoiceSession } from '@karen/api-contracts';
import { DuplexGate, floatLevel } from '@karen/domain';
import { bff, type BffOptions, type BffResult } from '../api';
import { blobToBase64, type SpeechLanguage } from './voice';
import { SseParser } from './sse';

export type LiveVoiceState =
  'idle' | 'connecting' | 'listening' | 'processing' | 'speaking' | 'error' | 'permission_denied';

export interface LiveTurn {
  text: string;
  language: SpeechLanguage | null;
  turnIndex: number;
  /** Idempotency-Key for sending this turn as a message: duplicates become no-ops. */
  idempotencyKey: string;
}

export interface LiveVoiceHandlers {
  onState?: (state: LiveVoiceState) => void;
  onPartial?: (text: string) => void;
  /** The user started speaking: interrupt KAREN (stop playback / generation). */
  onSpeechStarted?: () => void;
  onTurn?: (turn: LiveTurn) => void;
  /** The microphone heard the user clearly talking over KAREN: stop her playback now. */
  onBargeIn?: () => void;
  onClosed?: (reason: string) => void;
  onError?: (code: string) => void;
}

/** Minimal MediaRecorder surface used here (lets tests inject a fake). */
export interface RecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused';
  ondataavailable: ((event: { data: Blob }) => void) | null;
  start(timeslice: number): void;
  stop(): void;
}

/**
 * Microphone → recorder path with a level meter and a mute switch (Web Audio). `output` is what
 * gets recorded; muting records silence so the recording stays one continuous stream.
 */
export interface MicPipeline {
  readonly output: MediaStream;
  /** Current input RMS level (0..1). */
  level(): number;
  setPassing(passing: boolean): void;
  close(): void;
}

export interface LiveVoiceDeps {
  api?: <T>(path: string, options?: BffOptions) => Promise<BffResult<T>>;
  fetch?: typeof globalThis.fetch;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder?: (stream: MediaStream, mimeType: string) => RecorderLike;
  isTypeSupported?: (mimeType: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Builds the gated microphone path (default: Web Audio, else track muting). */
  createMicPipeline?: (stream: MediaStream) => Promise<MicPipeline>;
  now?: () => number;
}

/** How often the microphone level is checked by the echo gate. */
export const GATE_FRAME_MS = 40;

/**
 * Gate without Web Audio: a disabled microphone track records silence. No level meter, so no
 * voice barge-in (tapping still interrupts) — but KAREN's voice can never reach recognition.
 */
export function trackMutePipeline(stream: MediaStream): MicPipeline {
  return {
    output: stream,
    level: () => 0,
    setPassing(passing) {
      for (const track of stream.getTracks()) track.enabled = passing;
    },
    close: () => undefined,
  };
}

/**
 * Web Audio pipeline: mic → analyser (level) and mic → gain → MediaStreamDestination (recorded).
 * Falls back to `trackMutePipeline` when Web Audio is unavailable or the audio context cannot
 * run (e.g. no user gesture yet when "Hello KAREN" starts the conversation).
 */
export async function createWebAudioPipeline(stream: MediaStream): Promise<MicPipeline> {
  const Ctx =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return trackMutePipeline(stream);
  let ctx: AudioContext;
  try {
    ctx = new Ctx();
    if (ctx.state !== 'running') {
      await Promise.race([ctx.resume(), realSleep(250)]);
    }
  } catch (error) {
    console.warn('[karen] voice echo gate: no Web Audio', (error as Error).name); // eslint-disable-line no-console
    return trackMutePipeline(stream);
  }
  if (ctx.state !== 'running') {
    // A suspended context would record silence: never risk a deaf KAREN.
    void ctx.close().catch(() => undefined);
    return trackMutePipeline(stream);
  }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const gain = ctx.createGain();
  const destination = ctx.createMediaStreamDestination();
  source.connect(analyser);
  source.connect(gain);
  gain.connect(destination);
  const samples = new Float32Array(analyser.fftSize);
  let passing = true;
  return {
    output: destination.stream,
    level() {
      analyser.getFloatTimeDomainData(samples);
      return floatLevel(samples);
    },
    setPassing(next) {
      if (next === passing) return;
      passing = next;
      // A short ramp avoids clicks that the recogniser could hear as speech.
      gain.gain.setTargetAtTime(next ? 1 : 0, ctx.currentTime, 0.008);
    },
    close() {
      source.disconnect();
      gain.disconnect();
      void ctx.close().catch(() => undefined);
    },
  };
}

export const CHUNK_MS = 250;
const MAX_CHUNK_ATTEMPTS = 4;
const MAX_STREAM_ATTEMPTS = 6;
const CLOSE_WAIT_MS = 4_000;
const FORMATS = [
  { mimeType: 'audio/webm;codecs=opus', format: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', format: 'ogg' },
] as const;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function liveVoiceSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    FORMATS.some((f) => MediaRecorder.isTypeSupported(f.mimeType))
  );
}

/** One live session at a time. Create a new instance per conversation mode activation. */
export class LiveVoiceSession {
  private state: LiveVoiceState = 'idle';
  private session: VoiceSession | null = null;
  private media: MediaStream | null = null;
  private recorder: RecorderLike | null = null;
  private queue: Blob[] = [];
  private seq = 0;
  private pumping = false;
  private lastEventId: string | null = null;
  private readonly seenTurns = new Set<number>();
  private readonly abort = new AbortController();
  private closedResolve: (() => void) | null = null;
  private closed = false;
  private pipeline: MicPipeline | null = null;
  private gateTimer: ReturnType<typeof setInterval> | null = null;
  private readonly gate: DuplexGate;
  private readonly now: () => number;
  private readonly api: NonNullable<LiveVoiceDeps['api']>;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly handlers: LiveVoiceHandlers,
    private readonly deps: LiveVoiceDeps = {},
  ) {
    this.api = deps.api ?? bff;
    this.fetchImpl = deps.fetch ?? ((...a) => globalThis.fetch(...a));
    this.sleep = deps.sleep ?? realSleep;
    this.now = deps.now ?? (() => Date.now());
    this.gate = new DuplexGate(() => this.handlers.onBargeIn?.());
  }

  get current(): LiveVoiceState {
    return this.state;
  }

  get sessionId(): string | null {
    return this.session?.session_id ?? null;
  }

  get isMock(): boolean {
    return this.session?.is_mock ?? false;
  }

  /** The UI moves between listening / processing / speaking while a session is open. */
  setPhase(phase: 'listening' | 'processing' | 'speaking'): void {
    if (!this.session || this.closed) return;
    // KAREN's voice must not reach recognition while she speaks (and briefly after).
    this.gate.setSpeaking(phase === 'speaking', this.now());
    if (this.gate.passing) this.pipeline?.setPassing(true);
    this.setState(phase);
  }

  /** True while microphone audio reaches recognition (false while KAREN's voice is gated). */
  get micPassing(): boolean {
    return this.gate.passing;
  }

  private startGate(): void {
    const pipeline = this.pipeline;
    if (!pipeline) return;
    this.gateTimer = setInterval(() => {
      if (this.closed) return;
      pipeline.setPassing(this.gate.process(pipeline.level(), GATE_FRAME_MS, this.now()));
    }, GATE_FRAME_MS);
  }

  private setState(state: LiveVoiceState): void {
    if (this.state === state) return;
    this.state = state;
    this.handlers.onState?.(state);
  }

  async start(options: { conversationId?: string; language?: SpeechLanguage } = {}): Promise<void> {
    if (this.state !== 'idle') return;
    this.setState('connecting');
    const supported =
      this.deps.isTypeSupported ?? ((m: string) => MediaRecorder.isTypeSupported(m));
    const choice = FORMATS.find((f) => supported(f.mimeType));
    if (!choice) return this.fail('VOICE_UNSUPPORTED');
    try {
      const getUserMedia =
        this.deps.getUserMedia ??
        ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
      this.media = await getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.setState('permission_denied');
        this.handlers.onError?.('MIC_PERMISSION_DENIED');
        return;
      }
      return this.fail('MIC_UNAVAILABLE');
    }
    // Speed: the session (server + speech provider connection) opens WHILE the microphone is
    // already recording. Audio spoken meanwhile is queued and sent in order once the session
    // exists, so "Hey KAREN, <question>" in one breath is not lost and nobody waits to talk.
    const sessionRequest = this.api<VoiceSession>('/api/v1/voice/sessions', {
      method: 'POST',
      json: {
        audio_format: choice.format,
        ...(options.conversationId ? { conversation_id: options.conversationId } : {}),
        ...(options.language ? { language: options.language } : {}),
      },
    });
    const createPipeline = this.deps.createMicPipeline ?? createWebAudioPipeline;
    this.pipeline = await createPipeline(this.media);
    if (this.closed) {
      this.releaseMedia();
      await this.discardSession(sessionRequest);
      return;
    }
    const createRecorder =
      this.deps.createRecorder ??
      ((stream: MediaStream, mimeType: string) =>
        new MediaRecorder(stream, {
          mimeType,
          audioBitsPerSecond: 32_000,
        }) as unknown as RecorderLike);
    this.recorder = createRecorder(this.pipeline?.output ?? this.media, choice.mimeType);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && !this.closed) {
        this.queue.push(e.data);
        void this.pump();
      }
    };
    this.recorder.start(CHUNK_MS);
    this.startGate();
    this.setState('listening'); // already recording: the user can talk while it connects
    const created = await sessionRequest;
    if (this.closed) {
      await this.discardSession(Promise.resolve(created));
      return;
    }
    if (!created.ok) {
      this.stopRecorder();
      this.releaseMedia();
      this.queue = [];
      return this.fail(created.error.code);
    }
    this.session = created.data;
    void this.followEvents();
    void this.pump(); // send what was said while connecting
  }

  /** stop() came while the session was still being created: close it on the server too. */
  private async discardSession(request: Promise<BffResult<VoiceSession>>): Promise<void> {
    const created = await request;
    if (created.ok) {
      await this.api(`/api/v1/voice/sessions/${created.data.session_id}/close`, { method: 'POST' });
    }
  }

  /** Sends queued chunks strictly one at a time, in order. */
  private async pump(): Promise<void> {
    if (this.pumping || !this.session) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && !this.closed) {
        const blob = this.queue.shift()!;
        const seq = this.seq++;
        const audio_base64 = await blobToBase64(blob);
        if (!(await this.sendChunk(seq, audio_base64))) return;
      }
    } finally {
      this.pumping = false;
    }
  }

  private async sendChunk(seq: number, audio_base64: string): Promise<boolean> {
    const sid = this.session!.session_id;
    for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
      const res = await this.api(`/api/v1/voice/sessions/${sid}/audio`, {
        method: 'POST',
        json: { seq, audio_base64 },
      });
      if (res.ok) return true;
      // 404 = the session ended (idle/max duration) or is not ours: stop streaming.
      if (res.status === 404 || !res.error.retryable || attempt === MAX_CHUNK_ATTEMPTS) {
        if (res.status !== 404) this.handlers.onError?.(res.error.code);
        await this.teardown(res.status === 404 ? 'session_ended' : 'upload_failed');
        return false;
      }
      await this.sleep(250 * 2 ** (attempt - 1));
    }
    return false;
  }

  private async followEvents(): Promise<void> {
    const sid = this.session!.session_id;
    let failures = 0;
    while (!this.closed && failures < MAX_STREAM_ATTEMPTS) {
      const query = this.lastEventId ? `?after=${encodeURIComponent(this.lastEventId)}` : '';
      let res: Response;
      try {
        res = await this.fetchImpl(`/api/v1/voice/sessions/${sid}/events${query}`, {
          headers: { accept: 'text/event-stream' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: this.abort.signal,
        });
      } catch {
        if (this.abort.signal.aborted) return;
        failures++;
        await this.sleep(500 * 2 ** failures);
        continue;
      }
      if (res.status === 404 || res.status === 401 || res.status === 403) {
        await this.teardown('session_ended');
        return;
      }
      if (!res.ok || !res.body) {
        failures++;
        await this.sleep(500 * 2 ** failures);
        continue;
      }
      const parser = new SseParser();
      const decoder = new TextDecoder();
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
            failures = 0;
            if (frame.id) this.lastEventId = frame.id;
            let event: VoiceEvent;
            try {
              event = JSON.parse(frame.data) as VoiceEvent;
            } catch {
              continue;
            }
            this.apply(event);
            if (this.closed) return;
          }
        }
      } catch {
        if (this.abort.signal.aborted) return;
      }
      if (!this.closed) {
        failures++;
        await this.sleep(500 * 2 ** failures);
      }
    }
    if (!this.closed) {
      this.handlers.onError?.('STREAM_LOST');
      await this.teardown('stream_lost');
    }
  }

  private apply(event: VoiceEvent): void {
    switch (event.type) {
      case 'ready':
        break;
      case 'speech_started':
        this.handlers.onSpeechStarted?.();
        break;
      case 'partial':
        this.handlers.onPartial?.(event.text);
        break;
      case 'end_of_turn': {
        const index = event.turn_index ?? this.seenTurns.size;
        const text = event.text.trim();
        if (this.seenTurns.has(index)) break;
        this.seenTurns.add(index);
        this.handlers.onPartial?.('');
        if (!text) break; // noise / empty turn: nothing to send
        this.handlers.onTurn?.({
          text,
          language: event.language,
          turnIndex: index,
          idempotencyKey: `voice-${this.session!.session_id}-${index}`,
        });
        break;
      }
      case 'error':
        this.handlers.onError?.(event.code);
        break;
      case 'closed':
        this.finalize(event.reason);
        break;
    }
  }

  /** Ends the session: stops the microphone, asks the server to close, waits for `closed`. */
  async stop(): Promise<void> {
    if (!this.session || this.closed) {
      // Still connecting (or already ended): nothing more is recorded or sent.
      if (!this.session) this.closed = true;
      this.stopRecorder();
      this.releaseMedia();
      this.queue = [];
      if (this.state !== 'permission_denied') this.setState('idle');
      return;
    }
    this.stopRecorder();
    const waitClosed = new Promise<void>((resolve) => {
      this.closedResolve = resolve;
    });
    await this.api(`/api/v1/voice/sessions/${this.session.session_id}/close`, { method: 'POST' });
    await Promise.race([waitClosed, this.sleep(CLOSE_WAIT_MS)]);
    this.finalize('client_closed');
  }

  private async teardown(reason: string): Promise<void> {
    if (this.closed) return;
    if (this.session) {
      await this.api(`/api/v1/voice/sessions/${this.session.session_id}/close`, { method: 'POST' });
    }
    this.finalize(reason);
  }

  private finalize(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.stopRecorder();
    this.releaseMedia();
    this.queue = [];
    this.abort.abort();
    this.closedResolve?.();
    this.setState('idle');
    this.handlers.onClosed?.(reason);
  }

  private stopRecorder(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.ondataavailable = null;
      this.recorder.stop();
    }
    this.recorder = null;
  }

  private releaseMedia(): void {
    if (this.gateTimer) clearInterval(this.gateTimer);
    this.gateTimer = null;
    this.pipeline?.close();
    this.pipeline = null;
    this.media?.getTracks().forEach((t) => t.stop());
    this.media = null;
  }

  private fail(code: string): void {
    this.setState('error');
    this.handlers.onError?.(code);
  }
}
