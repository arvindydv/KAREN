/**
 * Browser voice I/O (ADR-0026), no third-party libraries:
 *  - `VoiceRecorder`: microphone → MediaRecorder (Opus where supported), auto-stops at 60 s.
 *    The recording is sent once for transcription and never stored by KAREN.
 *  - `SpeechPlayer`: plays a spoken reply as it streams (MediaSource for MP3 where supported,
 *    otherwise after download). `stop()` is the interruption: it pauses playback AND aborts the
 *    request, so the server stops synthesising (nothing further is billed).
 * Everything goes through the BFF (/api/v1); the browser never sees a key or the AI service.
 */
import {
  MAX_VOICE_AUDIO_MS,
  type SPEECH_LANGUAGES,
  type Transcription,
} from '@karen/api-contracts';
import { bff, readCsrfToken, type BffResult } from '../api';

/** English, Hindi (Devanagari), Hinglish. */
export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number];

export type VoiceAudioFormat = 'webm' | 'ogg' | 'm4a';

/** Container/codec preference; the first one this browser can record is used. */
const RECORDER_FORMATS: readonly { mimeType: string; format: VoiceAudioFormat }[] = [
  { mimeType: 'audio/webm;codecs=opus', format: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', format: 'ogg' },
  { mimeType: 'audio/mp4', format: 'm4a' },
];
/** ~32 kbit/s Opus keeps 60 s of speech far below the 700 kB upload cap. */
const AUDIO_BITS_PER_SECOND = 32_000;

export function voiceInputSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    RECORDER_FORMATS.some((f) => MediaRecorder.isTypeSupported(f.mimeType))
  );
}

export interface Recording {
  blob: Blob;
  format: VoiceAudioFormat;
  durationMs: number;
}

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private format: VoiceAudioFormat = 'webm';

  /** Called when the 60 s limit stops the recording by itself. */
  constructor(private readonly onAutoStop: () => void = () => undefined) {}

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  async start(): Promise<void> {
    const choice = RECORDER_FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mimeType));
    if (!choice) throw new Error('VOICE_UNSUPPORTED');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    this.format = choice.format;
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: choice.mimeType,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
    this.startedAt = performance.now();
    this.timer = setTimeout(() => this.onAutoStop(), MAX_VOICE_AUDIO_MS - 500);
  }

  /** Stops and returns the recording (microphone released). */
  stop(): Promise<Recording> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('VOICE_NOT_RECORDING'));
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const durationMs = Math.min(
          Math.round(performance.now() - this.startedAt),
          MAX_VOICE_AUDIO_MS,
        );
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        this.release();
        resolve({ blob, format: this.format, durationMs });
      };
      recorder.stop();
    });
  }

  /** Discards the recording and releases the microphone. */
  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.release();
  }

  private release(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** `languageHint` = the user's saved reply language (omitted when automatic). */
export async function transcribe(
  recording: Recording,
  languageHint?: SpeechLanguage,
): Promise<BffResult<Transcription>> {
  return bff<Transcription>('/api/v1/voice/transcriptions', {
    method: 'POST',
    json: {
      audio_base64: await blobToBase64(recording.blob),
      audio_format: recording.format,
      duration_ms: Math.max(1, recording.durationMs),
      ...(languageHint ? { language_hint: languageHint } : {}),
    },
  });
}

export interface PlaybackInfo {
  isMock: boolean;
  language: string | null;
}

export type PlaybackError = 'UNAVAILABLE' | 'LIMIT' | 'NETWORK' | 'PLAYBACK';

/** One reply at a time; starting a new one or calling stop() interrupts the current one. */
export class SpeechPlayer {
  private abort: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  async play(
    path: string,
    handlers: {
      onStart?: (info: PlaybackInfo) => void;
      /** Audio is actually coming out of the speakers now (first `playing` event). */
      onPlaying?: () => void;
      onEnd?: () => void;
      onError?: (error: PlaybackError) => void;
    } = {},
    /** Small JSON request body (voice preview); spoken replies send none. */
    json?: unknown,
  ): Promise<void> {
    this.stop();
    const abort = new AbortController();
    this.abort = abort;
    const headers: Record<string, string> = { accept: 'audio/mpeg, audio/wav' };
    const csrf = readCsrfToken();
    if (csrf) headers['x-csrf-token'] = csrf;
    if (json !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        headers,
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
        signal: abort.signal,
        credentials: 'same-origin',
      });
    } catch {
      if (!abort.signal.aborted) handlers.onError?.('NETWORK');
      return;
    }
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('audio/') || !response.body) {
      handlers.onError?.(response.status === 429 ? 'LIMIT' : 'UNAVAILABLE');
      return;
    }
    const audio = new Audio();
    this.audio = audio;
    audio.addEventListener('playing', () => handlers.onPlaying?.(), { once: true });
    audio.onended = () => {
      this.cleanup();
      handlers.onEnd?.();
    };
    audio.onerror = () => {
      if (!abort.signal.aborted) handlers.onError?.('PLAYBACK');
      this.cleanup();
    };
    handlers.onStart?.({
      isMock: response.headers.get('x-karen-is-mock') === 'true',
      language: response.headers.get('x-karen-speech-language'),
    });
    try {
      if (
        type.startsWith('audio/mpeg') &&
        typeof MediaSource !== 'undefined' &&
        MediaSource.isTypeSupported('audio/mpeg')
      ) {
        await this.stream(audio, response.body, abort.signal);
      } else {
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        this.objectUrl = URL.createObjectURL(blob);
        audio.src = this.objectUrl;
        await audio.play();
      }
    } catch {
      if (!abort.signal.aborted) handlers.onError?.('PLAYBACK');
      this.cleanup();
    }
  }

  /** Progressive MP3 playback: first sentence plays while later ones are still synthesised. */
  private async stream(
    audio: HTMLAudioElement,
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const source = new MediaSource();
    this.objectUrl = URL.createObjectURL(source);
    audio.src = this.objectUrl;
    await new Promise<void>((resolve) =>
      source.addEventListener('sourceopen', () => resolve(), { once: true }),
    );
    const buffer = source.addSourceBuffer('audio/mpeg');
    const reader = body.getReader();
    let started = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (signal.aborted) return;
      if (done) break;
      await new Promise<void>((resolve) => {
        buffer.addEventListener('updateend', () => resolve(), { once: true });
        buffer.appendBuffer(new Uint8Array(value));
      });
      if (!started) {
        started = true;
        await audio.play();
      }
    }
    if (source.readyState === 'open') source.endOfStream();
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
    this.audio?.pause();
    this.cleanup();
  }

  private cleanup(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.audio = null;
  }
}
