import type { Message } from '@karen/api-contracts';
import { DuplexGate, pcm16Level } from '@karen/domain';
import type { AudioStream, AudioStreamBuffer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Vibration } from 'react-native';
import { useServices } from '../../auth/services';
import { ApiRequestError, NetworkError, describeError } from '../../lib/api-error';
import { useChatActions, usageResetTime } from '../../lib/chat-queries';
import { usePreferences } from '../../lib/queries';
import { newUuid } from '../../lib/uuid';
import { useVoiceStore } from '../../state/voice-store';
import {
  VoiceAssistant,
  type AssistantDeps,
  type AssistantStage,
  type AssistantState,
  type ConversationListener,
} from './assistant';
import { LiveConversation } from './live-conversation';
import {
  liveTransport,
  playAnswer,
  prepareWakeListener,
  type WakeUnavailableReason,
} from './native';
import { audioLib, voiceSupport } from './native-modules';
import { TARGET_RATE, toPcm16Mono16k } from './pcm';

/** Cap on audio buffered while connecting (buffers are ~100 ms; ≈10 s). */
const MAX_EARLY_BUFFERS = 100;
const MIC_FORMAT = { sampleRate: TARGET_RATE, channels: 1, encoding: 'int16' as const };

/** Microphone stream hook chosen once per app binary (see native-modules.ts): stable hook order. */
function useRealMicStream(onBuffer: (buffer: AudioStreamBuffer) => void): AudioStream | null {
  return audioLib!.useAudioStream({ ...MIC_FORMAT, onBuffer }).stream;
}
function useNoMicStream(): AudioStream | null {
  return null;
}
const useMicStream = audioLib ? useRealMicStream : useNoMicStream;

export const VOICE_NOT_IN_BUILD =
  'This installed version of the KAREN app was built without voice. Install the new KAREN development build to talk to KAREN — typing works as usual.';

const WAKE_COPY: Record<WakeUnavailableReason, string> = {
  not_in_this_build:
    '“Hey KAREN” needs the KAREN development build (this app has no speech recogniser — e.g. Expo Go). Tap the mic to talk meanwhile.',
  recognizer_unavailable:
    'This phone has no speech recogniser for “Hey KAREN”. Tap the mic to talk instead.',
  no_on_device_recognition:
    '“Hey KAREN” needs on-device speech recognition (so nothing you say leaves the phone before you call KAREN), and this phone doesn’t offer it. Tap the mic to talk instead.',
  no_on_device_language:
    'To use “Hey KAREN”, download the English offline speech pack in your phone’s speech settings. Meanwhile, tap the mic to talk.',
  permission_denied:
    'Allow microphone and speech recognition for KAREN in your phone’s Settings to use “Hey KAREN”.',
};

/** What went wrong, in the user's terms. */
export function voiceProblem(error: unknown, stage: AssistantStage): string {
  const reset = usageResetTime(error);
  if (reset) return 'You’ve reached your AI limit for now, so KAREN can’t talk until it resets.';
  if (error instanceof NetworkError) return 'You’re offline, so KAREN can’t hear you right now.';
  if (error instanceof ApiRequestError) {
    if (error.code === 'CONSENT_REQUIRED') return 'Allow AI processing to talk to KAREN.';
    if (error.code === 'RATE_LIMITED')
      return 'Too many voice requests. Wait a moment and try again.';
    if (error.code === 'CONFLICT') return error.message;
    return describeError(error);
  }
  const code = error instanceof Error ? error.message : '';
  if (code === 'VOICE_NOT_IN_THIS_BUILD') return VOICE_NOT_IN_BUILD;
  if (code === 'USAGE_LIMIT_REACHED') {
    return 'You’ve reached your AI limit for now, so KAREN can’t talk until it resets.';
  }
  if (stage === 'wake' || code.startsWith('SPEECH_RECOGNIZER_')) {
    return 'Listening for “Hey KAREN” stopped — the phone’s speech recogniser reported a problem. Tap the mic to talk.';
  }
  if (stage === 'speak') return 'Couldn’t play KAREN’s voice. Her answer is in the chat.';
  if (stage === 'listen') {
    return 'KAREN couldn’t keep listening (connection problem). Tap the mic to try again.';
  }
  return describeError(error);
}

/**
 * The phone voice assistant for one screen (ADR-0030, ADR-0031): tap-to-talk, hands-free
 * "Hey/Hello KAREN", live listening with turn detection, KAREN speaking while she writes,
 * interruption. Listening stops whenever the app leaves the foreground or the screen unmounts.
 */
export function useVoiceAssistant(options: {
  conversationId: string | null;
  /** The conversation's messages. */
  messages: Message[];
  /** The text of the answer being written right now (live stream), for the echo guard. */
  liveAnswer?: { id: string; content: string } | null;
  /** Consent granted, voice enabled in settings and offered by the server. */
  allowed: boolean;
  /** New-chat screen: open a conversation after "Hey KAREN". */
  handoff?: (question: string | null) => boolean;
}) {
  const services = useServices();
  const actions = useChatActions();
  const preferences = usePreferences();
  const handsFree = useVoiceStore((s) => s.handsFree);
  const loaded = useVoiceStore((s) => s.loaded);
  const [state, setState] = useState<AssistantState>({
    phase: 'off',
    handsFree: false,
    followUp: false,
    heard: '',
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [wakeAvailable, setWakeAvailable] = useState<boolean | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  // Latest values for callbacks the (long-lived) assistant calls.
  const latest = useRef({ options, actions, services, preferences: preferences.data });
  latest.current = { options, actions, services, preferences: preferences.data };

  // Microphone → echo gate → live conversation. The phone's raw microphone stream has no echo
  // cancellation, so while KAREN speaks her voice would be transcribed as a user turn and she
  // would answer herself. The gate sends silence instead, and opens (barge-in) when the user
  // clearly talks over her (ADR-0033).
  const liveRef = useRef<LiveConversation | null>(null);
  const assistantRef = useRef<VoiceAssistant | null>(null);
  const gateRef = useRef<DuplexGate | null>(null);
  gateRef.current ??= new DuplexGate(() => assistantRef.current?.bargeIn());
  // Audio captured while the live session is still connecting (sent once it exists).
  const earlyRef = useRef<Uint8Array[] | null>(null);
  const mic = useMicStream((buffer) => {
    const live = liveRef.current;
    const early = earlyRef.current;
    if (!live && !early) return;
    const pcm = toPcm16Mono16k({
      data: buffer.data,
      sampleRate: buffer.sampleRate,
      channels: buffer.channels,
      encoding: 'int16',
    });
    const durationMs = pcm.length / 2 / (TARGET_RATE / 1000);
    const pass = gateRef.current!.process(pcm16Level(pcm), durationMs, Date.now());
    const out = pass ? pcm : new Uint8Array(pcm.length);
    if (live) live.sendPcm(out);
    else if (early && early.length < MAX_EARLY_BUFFERS) early.push(out);
  });
  const micRef = useRef(mic);
  micRef.current = mic;

  const depsRef = useRef<AssistantDeps | null>(null);
  if (!assistantRef.current) {
    const listener: ConversationListener = {
      async open(onEvent) {
        const stream = micRef.current;
        if (!stream || !audioLib) throw new Error('VOICE_NOT_IN_THIS_BUILD');
        const { services: s, options: o, preferences: p } = latest.current;
        const transport = liveTransport({
          api: s.api,
          baseUrl: s.baseUrl,
          streamFetch: s.streamFetch,
          getAccessToken: () => s.session.getAccessToken(),
          handleUnauthorized: (used) => s.session.handleUnauthorized(used),
        });
        const lang = p?.reply_language;
        // Speed: the microphone starts at once and records while the session (server + speech
        // provider connection) opens; that audio is sent first, so nothing said is lost.
        earlyRef.current = [];
        let live: LiveConversation;
        try {
          await audioLib.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
          await stream.start();
          live = await LiveConversation.open(
            transport,
            {
              ...(o.conversationId ? { conversationId: o.conversationId } : {}),
              ...(lang && lang !== 'auto' ? { language: lang } : {}),
            },
            onEvent,
          );
        } catch (error) {
          earlyRef.current = null;
          try {
            stream.stop();
          } catch (err) {
            if (__DEV__) console.warn('[karen] mic stop failed', (err as Error).name); // eslint-disable-line no-console
          }
          throw error;
        }
        for (const pcm of earlyRef.current ?? []) live.sendPcm(pcm);
        earlyRef.current = null;
        liveRef.current = live;
      },
      async close() {
        const live = liveRef.current;
        liveRef.current = null;
        earlyRef.current = null;
        try {
          micRef.current?.stop();
        } catch (err) {
          if (__DEV__) console.warn('[karen] mic stop failed', (err as Error).name); // eslint-disable-line no-console
        }
        await live?.close();
      },
    };
    const deps: AssistantDeps = {
      wake: null,
      listener,
      ask: async (text, key) => {
        const id = latest.current.options.conversationId;
        if (!id) throw new Error('NO_CONVERSATION');
        const res = await latest.current.actions.send(id, text, key, 'voice');
        return res.assistant_message.id;
      },
      speak: (messageId) => {
        const id = latest.current.options.conversationId;
        if (!id) return Promise.reject(new Error('NO_CONVERSATION'));
        const svc = latest.current.services;
        return Promise.resolve(
          playAnswer({
            baseUrl: svc.baseUrl,
            streamFetch: svc.streamFetch,
            getAccessToken: () => svc.session.getAccessToken(),
            handleUnauthorized: (used) => svc.session.handleUnauthorized(used),
            conversationId: id,
            messageId,
          }),
        );
      },
      answerText: (messageId) => {
        const o = latest.current.options;
        if (o.liveAnswer?.id === messageId) return o.liveAnswer.content;
        return o.messages.find((m) => m.id === messageId)?.content ?? '';
      },
      cancelAnswer: async (messageId) => {
        const id = latest.current.options.conversationId;
        if (id) await latest.current.actions.cancel(id, messageId);
      },
      cue: () => Vibration.vibrate(35),
      handoff: (question) => latest.current.options.handoff?.(question) ?? false,
      newKey: () => newUuid(),
    };
    depsRef.current = deps;
    assistantRef.current = new VoiceAssistant(deps, {
      onState: (next) => {
        const gate = gateRef.current!;
        if (next.phase === 'off' || next.phase === 'wake') gate.open();
        else gate.setSpeaking(next.phase === 'speaking', Date.now());
        setState(next);
      },
      onError: (error, stage) => setNotice(voiceProblem(error, stage)),
    });
  }
  const assistant = assistantRef.current;

  useEffect(() => {
    void useVoiceStore.getState().load();
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => {
      sub.remove();
      void assistant.stop();
    };
  }, [assistant]);

  /** Prepares on-device wake listening once; false (with a notice) when unavailable. */
  const ensureWake = useCallback(async (): Promise<boolean> => {
    const deps = depsRef.current!;
    if (deps.wake) return true;
    const setup = await prepareWakeListener((code) => {
      void assistant.stop();
      setNotice(voiceProblem(new Error(`SPEECH_RECOGNIZER_${code}`), 'wake'));
    });
    if (!setup.ok) {
      setWakeAvailable(false);
      setNotice(WAKE_COPY[setup.reason]);
      return false;
    }
    deps.wake = setup.listener;
    setWakeAvailable(true);
    return true;
  }, [assistant]);

  // Hands-free runs only while allowed, switched on and the app is in the foreground.
  useEffect(() => {
    if (!loaded) return;
    if (!options.allowed || !appActive) {
      void assistant.stop();
      return;
    }
    if (!handsFree || !voiceSupport.wakeWord) {
      assistant.stopHandsFree();
      return;
    }
    let cancelled = false;
    void ensureWake().then((ok) => {
      if (cancelled) return;
      if (ok) assistant.startHandsFree();
      else void useVoiceStore.getState().setHandsFree(false);
    });
    return () => {
      cancelled = true;
    };
  }, [assistant, appActive, ensureWake, handsFree, loaded, options.allowed]);

  const ensureMic = useCallback(async () => {
    if (!voiceSupport.talk || !audioLib) {
      setNotice(VOICE_NOT_IN_BUILD);
      return false;
    }
    const permission = await audioLib.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setNotice('Allow microphone access for KAREN in your phone’s Settings to talk to her.');
      return false;
    }
    return true;
  }, []);

  /** Tap: talk now / interrupt KAREN / end the conversation. */
  const talk = useCallback(async () => {
    setNotice(null);
    if (state.phase === 'off' || state.phase === 'wake') {
      if (!(await ensureMic())) return;
    }
    assistant.talkNow();
  }, [assistant, ensureMic, state.phase]);

  const setHandsFree = useCallback(
    async (on: boolean) => {
      setNotice(null);
      if (on && !(await ensureMic())) return;
      await useVoiceStore.getState().setHandsFree(on);
    },
    [ensureMic],
  );

  const askNow = useCallback(
    async (text: string) => {
      if (await ensureMic()) assistant.askNow(text);
    },
    [assistant, ensureMic],
  );

  return {
    state,
    handsFree: handsFree && voiceSupport.wakeWord,
    /** false when this binary or phone cannot listen for "Hey KAREN" (switch hidden). */
    wakeAvailable: voiceSupport.wakeWord ? wakeAvailable : false,
    /** false when this app binary has no voice native code at all. */
    supported: voiceSupport.talk,
    notice,
    clearNotice: () => setNotice(null),
    talk,
    setHandsFree,
    askNow,
    hangUp: () => assistant.hangUp(),
    stop: () => assistant.stop(),
  };
}
