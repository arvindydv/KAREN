import { WAKE_HINTS } from '@karen/domain';
import type { KarenApiClient } from '@karen/api-contracts/client';
import type { VoiceSession } from '@karen/api-contracts';
import type { AudioStatus } from 'expo-audio';
import type { ExpoSpeechRecognitionErrorCode } from 'expo-speech-recognition';
import { unwrap } from '../../lib/api-error';
import type { Playback, WakeListener } from './assistant';
import type { LiveTransport } from './live-conversation';
import { audioLib, fileSystemLib, speechLib } from './native-modules';

/** The loaded libraries; only called on paths where `voiceSupport` said they exist. */
const audio = () => {
  if (!audioLib) throw new Error('VOICE_NOT_IN_THIS_BUILD');
  return audioLib;
};
const fs = () => {
  if (!fileSystemLib) throw new Error('VOICE_NOT_IN_THIS_BUILD');
  return fileSystemLib;
};
const recognizer = () => {
  if (!speechLib) throw new Error('VOICE_NOT_IN_THIS_BUILD');
  return speechLib.ExpoSpeechRecognitionModule;
};

/**
 * Native adapters for the phone voice assistant (ADR-0030). Thin on purpose: all decisions live
 * in `assistant.ts` (unit-tested); these only talk to the platform. NOT VERIFIED on physical
 * devices — needs a development build (`expo run:android` / `expo run:ios` or EAS).
 */

// ------------------------------------------------------------------------------ wake listener

export type WakeUnavailableReason =
  | 'not_in_this_build'
  | 'recognizer_unavailable'
  | 'no_on_device_recognition'
  | 'no_on_device_language'
  | 'permission_denied';

export type WakeSetup =
  | { ok: true; listener: WakeListener; locale: string }
  | { ok: false; reason: WakeUnavailableReason };

/** Errors after which listening can simply be restarted (the recogniser ended a session). */
const RESTARTABLE: ReadonlySet<ExpoSpeechRecognitionErrorCode> = new Set([
  'no-speech',
  'speech-timeout',
  'aborted',
  'interrupted',
  'network',
  'busy',
  'client',
  'unknown',
  'too-many-requests',
]);
/** Preferred on-device locales for hearing "Hey KAREN" (English names, Indian accent first). */
const LOCALE_PREFERENCE = ['en-IN', 'en-GB', 'en-US'];

/**
 * Prepares on-device wake-word listening. Privacy rule: the recogniser must run ON the phone
 * (`requiresOnDeviceRecognition`), so ambient speech never leaves the device. Phones without an
 * on-device recogniser or language pack get tap-to-talk only.
 */
export async function prepareWakeListener(onFatal: (code: string) => void): Promise<WakeSetup> {
  if (!speechLib) return { ok: false, reason: 'not_in_this_build' };
  const m = recognizer();
  if (!m.isRecognitionAvailable()) return { ok: false, reason: 'recognizer_unavailable' };
  if (!m.supportsOnDeviceRecognition()) return { ok: false, reason: 'no_on_device_recognition' };
  const permission = await m.requestPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: 'permission_denied' };
  let installed: string[] = [];
  try {
    const supported = await m.getSupportedLocales({});
    installed = supported.installedLocales.length > 0 ? supported.installedLocales : [];
  } catch (err) {
    // Some recognisers cannot list locales; fall back to trying the preferred one.
    if (__DEV__) console.warn('[karen] getSupportedLocales failed', (err as Error).name); // eslint-disable-line no-console
    installed = [LOCALE_PREFERENCE[0]!];
  }
  const locale =
    LOCALE_PREFERENCE.find((l) => installed.includes(l)) ??
    installed.find((l) => l.toLowerCase().startsWith('en'));
  if (!locale) return { ok: false, reason: 'no_on_device_language' };
  return { ok: true, listener: new RecognizerWakeListener(locale, onFatal), locale };
}

class RecognizerWakeListener implements WakeListener {
  private wanted = false;
  private onHeard: ((text: string, isFinal: boolean) => void) | null = null;
  private subscriptions: { remove(): void }[] = [];
  private lastBegin = 0;
  private quickEnds = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private ended: (() => void) | null = null;

  constructor(
    private readonly locale: string,
    private readonly onFatal: (code: string) => void,
  ) {}

  async start(onHeard: (text: string, isFinal: boolean) => void): Promise<void> {
    this.onHeard = onHeard;
    this.wanted = true;
    this.quickEnds = 0;
    this.subscribe();
    await new Promise<void>((resolve, reject) => {
      const started = recognizer().addListener('start', () => {
        started.remove();
        failed.remove();
        resolve();
      });
      const failed = recognizer().addListener('error', (e) => {
        if (RESTARTABLE.has(e.error)) return;
        started.remove();
        failed.remove();
        this.wanted = false;
        reject(new Error(`SPEECH_RECOGNIZER_${e.error.toUpperCase().replace(/-/g, '_')}`));
      });
      this.begin();
    });
  }

  async stop(): Promise<void> {
    this.wanted = false;
    this.onHeard = null;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const ended = new Promise<void>((resolve) => {
      this.ended = resolve;
      setTimeout(resolve, 1_000); // never hang on a recogniser that does not report `end`
    });
    recognizer().abort();
    await ended;
    this.ended = null;
    this.unsubscribe();
  }

  private begin(): void {
    this.lastBegin = Date.now();
    recognizer().start({
      lang: this.locale,
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: false,
      maxAlternatives: 3,
      contextualStrings: [...WAKE_HINTS],
      // iOS: remove KAREN's own voice from the microphone signal while she speaks.
      iosVoiceProcessingEnabled: true,
    });
  }

  private subscribe(): void {
    if (this.subscriptions.length > 0) return;
    const m = recognizer();
    this.subscriptions = [
      m.addListener('result', (e) => {
        for (const r of e.results) this.onHeard?.(r.transcript, e.isFinal);
      }),
      m.addListener('error', (e) => {
        if (!this.wanted || RESTARTABLE.has(e.error)) return;
        this.wanted = false;
        this.onFatal(e.error);
      }),
      m.addListener('end', () => {
        this.ended?.();
        if (!this.wanted) return;
        // Continuous sessions still end (time limits, silence): restart, backing off when a
        // recogniser keeps ending immediately so it never spins.
        this.quickEnds = Date.now() - this.lastBegin < 1_500 ? this.quickEnds + 1 : 0;
        const delay = Math.min(300 * 2 ** this.quickEnds, 5_000);
        this.restartTimer = setTimeout(() => {
          if (this.wanted) this.begin();
        }, delay);
      }),
    ];
  }

  private unsubscribe(): void {
    for (const s of this.subscriptions) s.remove();
    this.subscriptions = [];
  }
}

// ---------------------------------------------------------------------------- live transport

/** The live-conversation API (ADR-0031) over the app's authenticated clients. */
export function liveTransport(deps: {
  api: KarenApiClient;
  baseUrl: string;
  streamFetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<string | undefined>;
  handleUnauthorized: (used: string | undefined) => Promise<string | undefined>;
}): LiveTransport {
  return {
    createSession: (body) => unwrap<VoiceSession>(deps.api.POST('/v1/voice/sessions', { body })),
    async sendAudio(sessionId, body) {
      const { response } = await deps.api.POST('/v1/voice/sessions/{sessionId}/audio', {
        params: { path: { sessionId } },
        body,
      });
      if (response.ok) return { ok: true };
      return {
        ok: false,
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
      };
    },
    async closeSession(sessionId) {
      await deps.api.POST('/v1/voice/sessions/{sessionId}/close', {
        params: { path: { sessionId } },
      });
    },
    async openEvents(sessionId, after, signal) {
      const url = `${deps.baseUrl.replace(/\/$/, '')}/v1/voice/sessions/${sessionId}/events${
        after ? `?after=${encodeURIComponent(after)}` : ''
      }`;
      const request = async (token: string | undefined) =>
        deps.streamFetch(url, {
          headers: {
            accept: 'text/event-stream',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          signal,
        });
      const token = await deps.getAccessToken();
      const res = await request(token);
      if (res.status !== 401 || !token) return res;
      const fresh = await deps.handleUnauthorized(token);
      return fresh ? request(fresh) : res;
    },
  };
}

// --------------------------------------------------------------------------------- playback

export interface SpeechFetchDeps {
  baseUrl: string;
  /** `expo/fetch`: native binary bodies (React Native's global fetch is unreliable for audio). */
  streamFetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<string | undefined>;
  handleUnauthorized: (used: string | undefined) => Promise<string | undefined>;
}

/** No sound from a clip within this long: the player is stuck; skip it. */
const CLIP_START_TIMEOUT_MS = 8_000;

const warn = (what: string, err: unknown) => {
  if (__DEV__) console.warn(`[karen] ${what}`, err instanceof Error ? err.message : err); // eslint-disable-line no-console
};

/**
 * Plays KAREN's answer (ADR-0033) as sentence clips: `POST …/speech?segment=N` returns one
 * complete clip (204 = no more); the next one is fetched while the current one plays, so
 * sentences follow each other. Each clip is one request we control — native players are never
 * given the URL (they re-request it, and every request restarted the answer: KAREN repeated
 * herself). Bytes come through `expo/fetch`; a failed clip download is retried once (nothing of
 * it was played). `stop()` cancels requests (no more synthesis) and stops playback. Temp files
 * are deleted after use.
 */
export function playAnswer(
  deps: SpeechFetchDeps & { conversationId: string; messageId: string },
): Playback {
  const controller = new AbortController();
  let stopped = false;
  let player: ReturnType<ReturnType<typeof audio>['createAudioPlayer']> | null = null;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let finish!: (r: 'ended' | 'error') => void;
  const done = new Promise<'ended' | 'error'>((resolve) => {
    finish = resolve;
  });
  const url = (segment: number) =>
    `${deps.baseUrl.replace(/\/$/, '')}/v1/conversations/${deps.conversationId}/messages/${deps.messageId}/speech?segment=${segment}`;

  const request = async (segment: number): Promise<Response> => {
    const send = (token: string | undefined) =>
      deps.streamFetch(url(segment), {
        method: 'POST',
        headers: {
          accept: 'audio/mpeg, audio/wav',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
    const token = await deps.getAccessToken();
    const res = await send(token);
    if (res.status !== 401 || !token) return res;
    const fresh = await deps.handleUnauthorized(token);
    return fresh ? send(fresh) : res;
  };

  const download = async (segment: number): Promise<Uint8Array | null> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await request(segment);
        if (res.status === 204) return null;
        if (res.status === 429) throw new Error('USAGE_LIMIT_REACHED');
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.startsWith('audio/')) throw new Error(`SPEECH_HTTP_${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0) throw new Error('SPEECH_EMPTY');
        return bytes;
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        const retryable =
          !controller.signal.aborted &&
          message !== 'USAGE_LIMIT_REACHED' &&
          !/^SPEECH_HTTP_4/.test(message);
        if (!retryable || attempt >= 2) throw err;
        warn(`speech clip ${segment} failed, retrying`, err);
      }
    }
  };

  type ClipFile = InstanceType<NonNullable<typeof fileSystemLib>['File']>;
  const toFile = async (segment: number, bytes: Uint8Array): Promise<ClipFile> => {
    const file = new (fs().File)(fs().Paths.cache, `karen-${deps.messageId}-${segment}.mp3`);
    if (file.exists) file.delete();
    file.create();
    await file.write(bytes); // async: the player must not open a half-written file
    return file;
  };
  const discard = (file: ClipFile | null) => {
    try {
      if (file?.exists) file.delete();
    } catch (err) {
      warn('could not delete reply audio', err);
    }
  };

  /** Plays one clip to the end. Resolves 'played' / 'failed' (never hangs). */
  const playClip = (file: ClipFile) =>
    new Promise<'played' | 'failed'>((resolve) => {
      const p = audio().createAudioPlayer({ uri: file.uri });
      player = p;
      let playing = false;
      const settle = (result: 'played' | 'failed') => {
        clearTimeout(timer);
        sub.remove();
        controller.signal.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => settle('played');
      const timer = setTimeout(() => {
        if (!playing) settle('failed');
      }, CLIP_START_TIMEOUT_MS);
      const sub = p.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (!playing && (status.playing || status.currentTime > 0)) {
          playing = true;
          markStarted();
        }
        if (status.didJustFinish) settle('played');
        else if (status.playbackState === 'failed' || status.playbackState === 'error') {
          settle(playing ? 'played' : 'failed');
        }
      });
      controller.signal.addEventListener('abort', onAbort);
      p.play();
    }).finally(() => {
      try {
        player?.pause();
        player?.remove();
      } catch (err) {
        warn('player release failed', err);
      }
      player = null;
      discard(file);
    });

  void (async () => {
    let playedAny = false;
    try {
      await audio().setAudioModeAsync({
        playsInSilentMode: true,
        // The microphone stays on during the conversation (the echo gate mutes it while KAREN
        // speaks; ADR-0033).
        allowsRecording: true,
        shouldRouteThroughEarpiece: false,
        interruptionMode: 'doNotMix',
      });
      let next: Promise<Uint8Array | null> = download(0);
      for (let segment = 0; !stopped; segment++) {
        const bytes = await next;
        if (!bytes || stopped) break;
        next = download(segment + 1); // prefetch while this one plays
        next.catch(() => undefined); // handled when awaited
        const result = await playClip(await toFile(segment, bytes));
        if (result === 'played') playedAny = true;
        else warn(`speech clip ${segment} did not play`, 'timeout/failed');
      }
      finish(playedAny || stopped ? 'ended' : 'error');
    } catch (err) {
      if (!stopped) warn('reply playback failed', err);
      // Part of the answer was heard: end quietly (the rest is in the chat), no alarming error.
      finish(stopped || playedAny ? 'ended' : 'error');
    } finally {
      markStarted();
    }
  })();

  return {
    started,
    done,
    stop() {
      stopped = true;
      controller.abort();
      try {
        player?.pause();
      } catch (err) {
        warn('pause failed', err);
      }
      finish('ended');
      return Promise.resolve();
    },
  };
}

/** "Play sample" (ADR-0031): KAREN's fixed sample line in `voiceId`. */
export function playVoicePreview(api: KarenApiClient, voiceId: string): Playback {
  let player: ReturnType<ReturnType<typeof audio>['createAudioPlayer']> | null = null;
  let file: InstanceType<NonNullable<typeof fileSystemLib>['File']> | null = null;
  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let finish!: (r: 'ended' | 'error') => void;
  const done = new Promise<'ended' | 'error'>((resolve) => {
    finish = resolve;
  });
  const cleanup = () => {
    try {
      player?.remove();
      if (file?.exists) file.delete();
    } catch (err) {
      if (__DEV__) console.warn('[karen] preview cleanup failed', (err as Error).name); // eslint-disable-line no-console
    }
    player = null;
  };
  void done.then(cleanup);
  void (async () => {
    try {
      const { data, response } = await api.POST('/v1/voice/preview', {
        body: { voice_id: voiceId },
        parseAs: 'arrayBuffer',
        signal: controller.signal,
      });
      if (!response.ok || !(data instanceof ArrayBuffer)) throw new Error('PLAYBACK_FAILED');
      await audio().setAudioModeAsync({
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      });
      file = new (fs().File)(fs().Paths.cache, `karen-preview-${voiceId}.mp3`);
      if (file.exists) file.delete();
      file.create();
      await file.write(new Uint8Array(data));
      const p = audio().createAudioPlayer({ uri: file.uri });
      player = p;
      p.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (status.didJustFinish) finish('ended');
      });
      p.play();
      markStarted();
    } catch {
      finish(controller.signal.aborted ? 'ended' : 'error');
    }
  })();
  return {
    started,
    done,
    stop() {
      controller.abort();
      try {
        player?.pause();
      } catch (err) {
        if (__DEV__) console.warn('[karen] preview pause failed', (err as Error).name); // eslint-disable-line no-console
      }
      finish('ended');
      return Promise.resolve();
    },
  };
}
