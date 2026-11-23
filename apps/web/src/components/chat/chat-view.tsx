'use client';

import type {
  AiUsage,
  Conversation,
  Message,
  Preferences,
  SendMessageResponse,
  VoiceOptions,
} from '@karen/api-contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { bff, handleSessionError, newIdempotencyKey, type BffResult } from '@/lib/api';
import { chatApi, resetsAt } from '@/lib/chat/api';
import {
  isActive,
  latestAssistant,
  messagesReducer,
  visibleMessages,
} from '@/lib/chat/messages-state';
import { followChatStream, type StreamConnection } from '@/lib/chat/stream-client';
import { useOnline, usePrefersReducedMotion } from '@/lib/chat/use-smooth-text';
import Link from 'next/link';
import { errorMessage, type ApiErrorBody } from '@/lib/errors';
import { Composer } from './composer';
import { IconArrowDown, IconClock } from './icons';
import { MessageItem } from './message-item';
import { conversationsKey } from './sidebar';
import {
  SpeechPlayer,
  transcribe,
  voiceInputSupported,
  VoiceRecorder,
  type PlaybackError,
} from '@/lib/chat/voice';
import {
  LiveVoiceSession,
  liveVoiceSupported,
  type LiveTurn,
  type LiveVoiceState,
} from '@/lib/chat/live-voice';
import { playWakeChime } from '@/lib/chat/earcon';
import {
  ECHO_TAIL_MS,
  isLikelyEcho,
  isUsableQuestion,
  matchWakePhrase,
  shouldInterrupt,
  stripLeadingWakeWords,
} from '@karen/domain';
import { BrowserWakeWord, wakeWordSupported, type WakeStatus } from '@/lib/chat/wake-word';
import { LiveVoicePanel } from './live-voice-panel';
import { VoiceMode } from './voice-mode';

const WAKE_STORAGE_KEY = 'karen.voice.hello_karen';
/** After KAREN stops talking, her last words can still reach the microphone for a moment. */

export interface ChatGateProps {
  consentGranted: boolean;
  consentVersion: number;
  privacyNoticeVersion: string | null;
  /** The user's saved "reduce motion" preference (in addition to the OS setting). */
  reducedMotionPreference: boolean;
  aiDisclosure: { version: string; content: string; draft: boolean } | null;
}

type Banner = { tone: 'danger' | 'warning' | 'info'; text: ReactNode; key: string } | null;

const draftKey = (id: string | null) => `karen.chat.draft.${id ?? 'new'}`;
const readDraft = (id: string | null): string => {
  try {
    return sessionStorage.getItem(draftKey(id)) ?? '';
  } catch {
    return '';
  }
};
const writeDraft = (id: string | null, value: string) => {
  try {
    if (value) sessionStorage.setItem(draftKey(id), value);
    else sessionStorage.removeItem(draftKey(id));
  } catch {
    // Storage disabled (private mode): drafts simply aren't kept across reloads.
  }
};

const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);

const SUGGESTIONS = [
  'Help me plan a weekend in Jaipur on a ₹15,000 budget',
  'Kal ki meeting ke liye ek short agenda likh do',
  'Explain the difference between a lakh and a million',
  'मुझे एक विनम्र छुट्टी का आवेदन लिखने में मदद करें',
];

const noSubscription = () => () => undefined;

/**
 * One conversation (or a new one when `conversationId` is null): transcript, live streaming,
 * composer and every chat state (consent, limits, offline, errors).
 */
export function ChatView({
  conversationId,
  gate,
}: {
  conversationId: string | null;
  gate: ChatGateProps;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const osReducedMotion = usePrefersReducedMotion();
  const reduceMotion = osReducedMotion || gate.reducedMotionPreference;

  const [state, dispatch] = useReducer(messagesReducer, { items: [], olderCursor: null });
  const itemsRef = useRef(state.items);
  useEffect(() => {
    itemsRef.current = state.items;
  });
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error' | 'missing'>(
    conversationId ? 'loading' : 'ready',
  );
  const [loadError, setLoadError] = useState<ApiErrorBody | null>(null);
  // ---- voice (ADR-0026): mic input → transcript for review; replies read aloud on request.
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const playerRef = useRef<SpeechPlayer | null>(null);
  const voiceTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  // Browser capability, read client-side only (server render: no mic button).
  const voiceSupported = useSyncExternalStore(noSubscription, voiceInputSupported, () => false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [voiceAutoplay, setVoiceAutoplay] = useState(false);
  // ---- voice preferences + live conversation mode (ADR-0027).
  const [voicePrefs, setVoicePrefs] = useState<Pick<
    Preferences,
    'voice_enabled' | 'voice_replies' | 'reply_language'
  > | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOptions | null>(null);
  const liveRef = useRef<LiveVoiceSession | null>(null);
  const [liveState, setLiveState] = useState<LiveVoiceState>('idle');
  const [livePartial, setLivePartial] = useState('');
  const [liveMock, setLiveMock] = useState(false);
  const liveSupported = useSyncExternalStore(noSubscription, liveVoiceSupported, () => false);
  const draftFromVoice = useRef(false);
  const autoplayFor = useRef<string | null>(null);
  // What KAREN is (or just was) saying aloud: the live-voice echo guard compares against it.
  // `id`: while KAREN speaks an answer that is still being written, its text keeps growing.
  const spokenRef = useRef<{ id: string; text: string; until: number } | null>(null);
  // True while the user wants to be in a live conversation (survives a session rollover).
  const wantLive = useRef(false);
  const [draft, setDraftState] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [consent, setConsent] = useState(gate.consentGranted);
  const [consentVersion, setConsentVersion] = useState(gate.consentVersion);
  const [announce, setAnnounce] = useState('');
  const online = useOnline();
  const [connection, setConnection] = useState<StreamConnection>('closed');
  const [ephemeral, setEphemeral] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** Messages that streamed while this view was open (only those animate). */
  const [liveIds, setLiveIds] = useState<ReadonlySet<string>>(() => new Set());
  const markLive = useCallback(
    (id: string) => setLiveIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
    [],
  );
  const pendingKey = useRef<{ content: string; key: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef<string | null>(null);

  const conversation = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: conversationId !== null,
    queryFn: async () => {
      const res = await chatApi.get(conversationId!);
      if (!res.ok) throw Object.assign(new Error(res.error.message), { status: res.status });
      return res.data;
    },
    retry: false,
  });
  const usage = useQuery({
    queryKey: ['ai-usage'],
    queryFn: async () => {
      const res = await chatApi.usage();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 15_000,
  });

  const notify = useCallback((text: string) => {
    setAnnounce('');
    // Re-set on the next tick so screen readers announce repeated identical messages.
    setTimeout(() => setAnnounce(text), 30);
  }, []);

  useEffect(() => {
    void bff<Preferences>('/api/v1/me/preferences').then((r) => {
      if (!r.ok) return;
      setVoiceAutoplay(r.data.voice_autoplay);
      setVoicePrefs({
        voice_enabled: r.data.voice_enabled,
        voice_replies: r.data.voice_replies,
        reply_language: r.data.reply_language,
      });
    });
    void bff<VoiceOptions>('/api/v1/voice/options').then((r) => {
      if (r.ok) setVoiceOptions(r.data);
    });
    return () => {
      void liveRef.current?.stop();
      recorderRef.current?.cancel();
      playerRef.current?.stop();
      if (voiceTimer.current) clearInterval(voiceTimer.current);
    };
  }, []);

  const player = () => (playerRef.current ??= new SpeechPlayer());

  const endSpoken = useCallback(() => {
    const spoken = spokenRef.current;
    if (spoken && spoken.until === Number.POSITIVE_INFINITY) {
      const latest = itemsRef.current.find((m) => m.id === spoken.id)?.content ?? spoken.text;
      spokenRef.current = { id: spoken.id, text: latest, until: Date.now() + ECHO_TAIL_MS };
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    playerRef.current?.stop();
    endSpoken();
    setSpeakingId(null);
    // KAREN is silent again: the live microphone gate must not stay closed (ADR-0033).
    if (liveRef.current?.current === 'speaking') liveRef.current.setPhase('listening');
  }, [endSpoken]);

  /** KAREN's words that may still be echoing into the microphone, or null. */
  const recentlySpoken = () => {
    const spoken = spokenRef.current;
    if (!spoken || spoken.until <= Date.now()) return null;
    return itemsRef.current.find((m) => m.id === spoken.id)?.content || spoken.text;
  };

  const PLAYBACK_COPY: Record<PlaybackError, string> = {
    UNAVAILABLE: 'Reading aloud isn’t available right now.',
    LIMIT: 'You’ve reached your AI limit for now; reading aloud resumes after it resets.',
    NETWORK: 'Couldn’t reach KAREN to read this aloud.',
    PLAYBACK: 'Your browser couldn’t play this audio.',
  };

  function listen(messageId: string, text?: string) {
    if (!conversationId) return;
    if (speakingId === messageId) {
      stopSpeaking();
      return;
    }
    setSpeakingId(messageId);
    spokenRef.current = {
      id: messageId,
      text: text ?? itemsRef.current.find((m) => m.id === messageId)?.content ?? '',
      until: Number.POSITIVE_INFINITY,
    };
    void player().play(`/api/v1/conversations/${conversationId}/messages/${messageId}/speech`, {
      onStart: (info) => {
        if (info.isMock) notify('Mock voice: silent audio, no speech model was called.');
      },
      // Only once audio is really audible: the live gate then keeps KAREN's voice out of the
      // microphone (ADR-0033). Before that the user can still keep talking.
      onPlaying: () => liveRef.current?.setPhase('speaking'),
      onEnd: () => {
        endSpoken();
        liveRef.current?.setPhase('listening');
        setSpeakingId((id) => (id === messageId ? null : id));
      },
      onError: (error) => {
        endSpoken();
        liveRef.current?.setPhase('listening');
        setSpeakingId((id) => (id === messageId ? null : id));
        notify(PLAYBACK_COPY[error]);
      },
    });
  }

  function endVoiceTimer() {
    if (voiceTimer.current) clearInterval(voiceTimer.current);
    voiceTimer.current = null;
  }

  async function startVoice() {
    stopSpeaking(); // the user talking interrupts KAREN speaking (barge-in)
    const recorder = new VoiceRecorder(() => void stopVoice());
    try {
      await recorder.start();
    } catch (error) {
      recorder.cancel();
      notify(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Microphone access is blocked. Allow it in your browser settings to speak to KAREN.'
          : 'Couldn’t start the microphone.',
      );
      return;
    }
    recorderRef.current = recorder;
    setVoiceSeconds(0);
    setVoiceState('recording');
    voiceTimer.current = setInterval(() => setVoiceSeconds((n) => n + 1), 1000);
  }

  function cancelVoice() {
    recorderRef.current?.cancel();
    recorderRef.current = null;
    endVoiceTimer();
    setVoiceState('idle');
  }

  async function stopVoice() {
    const recorder = recorderRef.current;
    if (!recorder?.recording) return;
    recorderRef.current = null;
    endVoiceTimer();
    setVoiceState('transcribing');
    const recording = await recorder.stop();
    const hint = voicePrefs?.reply_language;
    const result = await transcribe(recording, hint && hint !== 'auto' ? hint : undefined);
    setVoiceState('idle');
    if (!result.ok) {
      notify(result.error.message || 'Couldn’t transcribe that. Please try again or type instead.');
      return;
    }
    const text = result.data.text.trim();
    if (!text) {
      notify('KAREN didn’t catch anything. Please try again.');
      return;
    }
    // Review before sending: the transcript goes through the same send path as typed text.
    setDraft(draft.trim() ? `${draft.trim()} ${text}` : text);
    draftFromVoice.current = true;
    notify(
      result.data.is_mock
        ? 'Mock transcript (no speech model was called). Review it, then send.'
        : 'Here’s what KAREN heard. Review it, then send.',
    );
  }

  // Draft restore after hydration (sessionStorage does not exist during server rendering).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration-safe restore
    setDraftState(readDraft(conversationId));
  }, [conversationId]);

  const setDraft = (v: string) => {
    setDraftState(v);
    writeDraft(conversationId, v);
  };

  // Initial load (latest page).
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void (async () => {
      const res = await chatApi.messages(conversationId);
      if (cancelled) return;
      if (!res.ok) {
        if (handleSessionError(res.error, res.status)) return;
        setLoadError(res.error);
        setLoadState(res.status === 404 ? 'missing' : 'error');
        return;
      }
      // Answers still being written when the page opens animate as they arrive.
      for (const m of res.data.items) if (isActive(m)) markLive(m.id);
      dispatch({ type: 'loaded', items: res.data.items, olderCursor: res.data.next_cursor });
      setLoadState('ready');
      requestAnimationFrame(() =>
        scroller.current?.scrollTo({ top: scroller.current.scrollHeight }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, markLive]);

  // Follow the (single) active assistant message, resuming after its last applied event.
  const active = visibleMessages(state.items).filter(isActive).at(-1) ?? null;
  const activeId = active?.id ?? null;
  const activeSeq = active?.last_event_seq ?? 0;
  useEffect(() => {
    if (!conversationId || !activeId || following.current === activeId) return;
    following.current = activeId;
    const abort = new AbortController();
    const messageId = activeId;
    void followChatStream({
      path: chatApi.streamPath(conversationId, messageId),
      afterSeq: activeSeq,
      signal: abort.signal,
      onConnection: setConnection,
      onEvent: (event) => {
        if (event.type === 'token_delta' || event.type === 'status') markLive(messageId);
        dispatch({ type: 'event', messageId, event });
      },
    }).then(async (outcome) => {
      if (outcome.kind === 'aborted') return;
      following.current = null;
      if (outcome.kind === 'error' && outcome.error) {
        if (handleSessionError(outcome.error, outcome.status)) return;
      }
      // Re-sync the stored message (exact text, feedback state) and the sidebar.
      const fresh = await chatApi.message(conversationId, messageId);
      if (fresh.ok) dispatch({ type: 'upsert', messages: [fresh.data] });
      if (outcome.kind === 'terminal') {
        const e = outcome.event;
        if (e.type === 'complete' && autoplayFor.current === messageId) {
          autoplayFor.current = null;
          listen(messageId, fresh.ok ? fresh.data.content : undefined);
        } else if (liveRef.current && spokenRef.current?.until !== Number.POSITIVE_INFINITY) {
          // (While KAREN is still speaking this answer, she stays in the speaking phase.)
          liveRef.current.setPhase('listening');
        }
        notify(
          e.type === 'complete'
            ? 'KAREN finished answering.'
            : e.type === 'error' && e.status === 'canceled'
              ? 'Answer stopped.'
              : 'The answer did not finish.',
        );
      }
      void client.invalidateQueries({ queryKey: conversationsKey });
      void client.invalidateQueries({ queryKey: ['ai-usage'] });
    });
    return () => {
      abort.abort();
      following.current = null;
    };
    // activeSeq is the resume point at (re)start only; it must not restart the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, activeId, client, notify, markLive]);

  // Auto-scroll only when the reader is already at the bottom.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };
  const lastContentLength = state.items.at(-1)?.content.length ?? 0;
  useEffect(() => {
    if (!atBottom) return;
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [state.items.length, lastContentLength, atBottom, reduceMotion]);

  function jumpToLatest() {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
    setAtBottom(true);
  }

  async function loadOlder() {
    if (!conversationId || !state.olderCursor) return;
    const el = scroller.current;
    const before = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    const res = await chatApi.messages(conversationId, state.olderCursor);
    setLoadingOlder(false);
    if (!res.ok) {
      setBanner({ tone: 'danger', text: errorMessage(res.error), key: 'older' });
      return;
    }
    dispatch({ type: 'older', items: res.data.items, olderCursor: res.data.next_cursor });
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - before; // keep the reader's place
    });
  }

  /** Shared handling of a failed chat mutation; returns true when handled with a banner. */
  function handleFailure(error: ApiErrorBody, status: number): void {
    if (handleSessionError(error, status)) return;
    switch (error.code) {
      case 'CONSENT_REQUIRED':
        setConsent(false);
        return;
      case 'USAGE_LIMIT_REACHED': {
        const at = resetsAt(error.next_options);
        setBanner({
          tone: 'warning',
          key: 'limit',
          text: at
            ? `You’ve reached your chat limit for now. It resets ${fmtTime(at)}.`
            : 'You’ve reached your chat limit for now. It resets automatically.',
        });
        void client.invalidateQueries({ queryKey: ['ai-usage'] });
        return;
      }
      case 'RATE_LIMITED':
        setBanner({
          tone: 'warning',
          key: 'rate',
          text: 'You’re sending messages too quickly. Please wait a moment and try again.',
        });
        return;
      case 'CONFLICT':
        setBanner({ tone: 'info', key: 'conflict', text: error.message });
        return;
      default:
        setBanner({
          tone: 'danger',
          key: 'error',
          text: (
            <>
              {errorMessage(error)}{' '}
              {error.correlation_id && error.correlation_id !== 'client' ? (
                <span className="text-xs opacity-80">Reference: {error.correlation_id}</span>
              ) : null}
            </>
          ),
        });
    }
  }

  function applySent(data: SendMessageResponse) {
    markLive(data.assistant_message.id);
    dispatch({ type: 'upsert', messages: [data.user_message, data.assistant_message] });
    notify('Message sent. KAREN is answering.');
    setAtBottom(true);
  }

  async function send() {
    const content = draft;
    if (!content.trim()) return;
    setBusy(true);
    setBanner(null);
    // Reuse the key when retrying the SAME text after a failure (no duplicate messages).
    if (!pendingKey.current || pendingKey.current.content !== content) {
      pendingKey.current = { content, key: newIdempotencyKey() };
    }
    let targetId = conversationId;
    if (!targetId) {
      const created = await chatApi.create({ mode: ephemeral ? 'ephemeral' : 'standard' });
      if (!created.ok) {
        setBusy(false);
        handleFailure(created.error, created.status);
        return;
      }
      targetId = created.data.id;
    }
    // A voice message whose answer will be read aloud is answered in a spoken style (ADR-0029).
    const spokenTurn = draftFromVoice.current && voiceAutoplay;
    const res = await chatApi.send(
      targetId,
      content,
      pendingKey.current.key,
      spokenTurn ? 'voice' : 'text',
    );
    setBusy(false);
    if (!res.ok) {
      handleFailure(res.error, res.status);
      if (!conversationId && targetId) {
        // Keep the draft with the new conversation so nothing typed is lost.
        writeDraft(targetId, content);
        writeDraft(null, '');
        router.replace(`/app/chat/${targetId}`);
      }
      return;
    }
    pendingKey.current = null;
    // A voice-originated message gets its answer read aloud when the user chose autoplay.
    autoplayFor.current =
      draftFromVoice.current && voiceAutoplay ? res.data.assistant_message.id : null;
    draftFromVoice.current = false;
    setDraft('');
    void client.invalidateQueries({ queryKey: conversationsKey });
    if (!conversationId) {
      writeDraft(null, '');
      router.replace(`/app/chat/${targetId}`);
      return;
    }
    applySent(res.data);
  }

  // ---- live conversation (ADR-0027): hands-free turns sent exactly like typed messages.
  const liveCtx = useRef({ conversationId, activeId: active?.id ?? null, speakingId, voicePrefs });
  useEffect(() => {
    liveCtx.current = { conversationId, activeId: active?.id ?? null, speakingId, voicePrefs };
  });

  async function sendLiveTurn(turn: LiveTurn) {
    const ctx = liveCtx.current;
    if (!ctx.conversationId) return;
    // KAREN's own voice picked up by the microphone is not a user turn (prevents a loop).
    if (isLikelyEcho(turn.text, recentlySpoken())) return;
    // "Hello KAREN" on its own is a greeting to start listening, not a question; with a question
    // in the same breath, only the question is sent.
    const wake = matchWakePhrase(turn.text);
    if (wake && !isUsableQuestion(wake.rest)) return;
    if (wake) turn = { ...turn, text: wake.rest };
    // Recording starts the instant "Hello KAREN" is heard: a turn may begin with its tail.
    const question = stripLeadingWakeWords(turn.text);
    if (!question) return;
    turn = { ...turn, text: question };
    // A real turn while KAREN is still talking or writing replaces that answer.
    if (ctx.speakingId || ctx.activeId) bargeIn();
    liveRef.current?.setPhase('processing');
    // The Idempotency-Key is derived from the session and turn: a repeated turn is a no-op.
    const res = await chatApi.send(ctx.conversationId, turn.text, turn.idempotencyKey, 'voice');
    if (!res.ok) {
      liveRef.current?.setPhase('listening');
      handleFailure(res.error, res.status);
      return;
    }
    autoplayFor.current = null;
    applySent(res.data);
    // ADR-0031: start speaking right away — the server begins with the first sentence while the
    // rest of the answer is still being written (instead of waiting for the whole answer).
    if (ctx.voicePrefs?.voice_replies !== false) listen(res.data.assistant_message.id, '');
  }

  /** Partial transcript: show it, and interrupt KAREN only for real words (not echo or noise). */
  function onLivePartial(text: string) {
    const spoken = recentlySpoken();
    setLivePartial(isLikelyEcho(text, spoken) ? '' : text);
    const ctx = liveCtx.current;
    if ((ctx.speakingId || ctx.activeId) && shouldInterrupt(text, spoken)) bargeIn();
  }

  function bargeIn() {
    const ctx = liveCtx.current;
    // The user started talking: KAREN stops speaking and stops writing the current answer.
    if (ctx.speakingId) stopSpeaking();
    autoplayFor.current = null;
    if (ctx.conversationId && ctx.activeId) {
      void chatApi.cancel(ctx.conversationId, ctx.activeId).then((r) => {
        if (r.ok) dispatch({ type: 'upsert', messages: [r.data] });
      });
    }
    liveRef.current?.setPhase('listening');
  }

  async function startLive() {
    if (liveRef.current) return;
    stopSpeaking();
    let targetId = conversationId;
    if (!targetId) {
      const created = await chatApi.create({ mode: ephemeral ? 'ephemeral' : 'standard' });
      if (!created.ok) {
        handleFailure(created.error, created.status);
        return;
      }
      targetId = created.data.id;
      void client.invalidateQueries({ queryKey: conversationsKey });
      router.replace(`/app/chat/${targetId}?talk=1`);
      return;
    }
    wantLive.current = true;
    const lang = voicePrefs?.reply_language;
    const session = new LiveVoiceSession({
      onState: setLiveState,
      onPartial: onLivePartial,
      // A bare "speech started" may be a cough or KAREN's echo: interruption waits for words.
      onTurn: (turn) => void sendLiveTurn(turn),
      // The user is clearly talking over KAREN (local microphone level, ADR-0033): she stops
      // speaking at once; the answer being written is replaced only when their words arrive.
      onBargeIn: () => stopSpeaking(),
      onError: (code) => {
        if (code === 'MIC_PERMISSION_DENIED') {
          notify(
            'Microphone access is blocked. Allow it in your browser settings to talk to KAREN.',
          );
        } else if (code !== 'STREAM_LOST') {
          notify('Live voice had a problem. You can keep talking or switch to typing.');
        }
      },
      onClosed: (reason) => {
        liveRef.current = null;
        setLivePartial('');
        setLiveMock(false);
        if (reason === 'max_duration' && wantLive.current) {
          // A session has a bounded length (cost cap); keep the conversation going seamlessly.
          void startLive();
          return;
        }
        wantLive.current = false;
        notify(
          reason === 'idle_timeout'
            ? 'Voice conversation ended after a pause.'
            : reason === 'max_duration'
              ? 'Voice conversation reached its time limit.'
              : 'Voice conversation ended.',
        );
      },
    });
    liveRef.current = session;
    await session.start({
      conversationId: targetId,
      ...(lang && lang !== 'auto' ? { language: lang } : {}),
    });
    if (session.current === 'permission_denied' || session.current === 'error') {
      liveRef.current = null;
      wantLive.current = false;
      return;
    }
    setLiveMock(session.isMock);
  }

  async function stopLive() {
    wantLive.current = false;
    const session = liveRef.current;
    liveRef.current = null;
    stopSpeaking();
    await session?.stop();
    setLiveState('idle');
  }

  // ---- Voice mode (ADR-0032): an immersive orb screen whenever a voice conversation runs.
  const [voiceModeOpen, setVoiceModeOpen] = useState(false);
  const showVoiceMode = voiceModeOpen || liveState !== 'idle';
  function closeVoiceMode() {
    setVoiceModeOpen(false);
    void stopLive();
  }
  function onOrb() {
    if (liveState === 'speaking' || liveState === 'processing') bargeIn();
    else if (liveState === 'listening' || liveState === 'connecting') void stopLive();
    else void startLive();
  }
  /** A suggestion tapped in voice mode is asked (and answered) out loud. */
  function askAloud(text: string) {
    void sendLiveTurn({
      text,
      language: null,
      turnIndex: -1,
      idempotencyKey: newIdempotencyKey(),
    });
  }

  // ---- "Hello KAREN" (ADR-0031): on-device wake word. While the switch is on and no voice
  // conversation is running, a local model listens for the phrase; then the conversation starts.
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeStatus, setWakeStatus] = useState<WakeStatus | null>(null);
  const wakeSupported = useSyncExternalStore(noSubscription, wakeWordSupported, () => false);
  useEffect(() => {
    try {
      // Per-device preference (this computer's microphone), so localStorage is the right place.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
      setWakeOn(window.localStorage.getItem(WAKE_STORAGE_KEY) === '1');
    } catch {
      // Storage blocked (private mode): the switch simply starts off.
    }
  }, []);
  const toggleWake = (on: boolean) => {
    setWakeOn(on);
    if (!on) setWakeStatus(null);
    try {
      window.localStorage.setItem(WAKE_STORAGE_KEY, on ? '1' : '0');
    } catch {
      // Not persisted (storage blocked); the switch still works for this visit.
    }
  };
  const wakeAllowed =
    wakeOn &&
    wakeSupported &&
    consent &&
    (voicePrefs?.voice_enabled ?? true) &&
    voiceOptions?.available !== false &&
    voiceOptions?.live_available === true;
  const startLiveRef = useRef(startLive);
  startLiveRef.current = startLive;
  useEffect(() => {
    if (!wakeAllowed || liveState !== 'idle') return;
    const wake = new BrowserWakeWord(() => {
      wake.stop();
      playWakeChime(); // instant "I heard you" while the conversation connects
      void startLiveRef.current();
    }, setWakeStatus);
    void wake.start();
    return () => wake.stop();
  }, [wakeAllowed, liveState]);

  // A new chat started from "Talk to KAREN" lands here with ?talk=1: continue in live mode.
  useEffect(() => {
    if (!conversationId || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('talk') !== '1') return;
    url.searchParams.delete('talk');
    window.history.replaceState(null, '', url.pathname + url.search);
    void startLive();
    // startLive reads the latest state through refs; run once per conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function stop() {
    if (!conversationId || !active) return;
    const res = await chatApi.cancel(conversationId, active.id);
    if (res.ok) dispatch({ type: 'upsert', messages: [res.data] });
    else handleFailure(res.error, res.status);
  }

  async function regenerate(m: Message) {
    if (!conversationId) return;
    setBusy(true);
    setBanner(null);
    const res = await chatApi.regenerate(conversationId, m.id, newIdempotencyKey());
    setBusy(false);
    if (!res.ok) {
      handleFailure(res.error, res.status);
      return;
    }
    markLive(res.data.assistant_message.id);
    dispatch({
      type: 'upsert',
      messages: [{ ...m, superseded: true }, res.data.assistant_message],
    });
    notify('Regenerating the answer.');
  }

  async function feedback(m: Message, run: () => Promise<BffResult<Message>>) {
    const res = await run();
    if (res.ok) {
      dispatch({ type: 'upsert', messages: [res.data] });
      notify('Thanks — feedback saved.');
    } else handleFailure(res.error, res.status);
    void m;
  }

  async function fork(m: Message, content: string) {
    if (!conversationId) return;
    setBusy(true);
    const res = await chatApi.fork(conversationId, m.id, content, newIdempotencyKey());
    setBusy(false);
    if (!res.ok) {
      handleFailure(res.error, res.status);
      return;
    }
    void client.invalidateQueries({ queryKey: conversationsKey });
    router.push(`/app/chat/${res.data.conversation.id}`);
  }

  async function grantConsent() {
    if (!gate.privacyNoticeVersion) return;
    setBusy(true);
    const res = await bff<{ state: { version: number; decision: string } }>(
      '/api/v1/me/consents/AI_PROCESSING',
      {
        method: 'PUT',
        json: { decision: 'grant', notice_version: gate.privacyNoticeVersion, source: 'settings' },
        version: consentVersion,
        idempotencyKey: newIdempotencyKey(),
      },
    );
    setBusy(false);
    if (res.ok) {
      setConsent(true);
      setConsentVersion(res.data.state.version);
      setBanner(null);
      notify('AI processing allowed. You can chat now.');
      return;
    }
    if (handleSessionError(res.error, res.status)) return;
    if (res.status === 412) {
      router.refresh();
    }
    setBanner({ tone: 'danger', key: 'consent', text: errorMessage(res.error) });
  }

  const visible = visibleMessages(state.items);
  const latest = latestAssistant(state.items);
  const generating = active !== null;
  // Voice preferences (ADR-0027): defaults are on until loaded, so existing users see no change.
  const voiceInputAllowed =
    (voicePrefs?.voice_enabled ?? true) && voiceOptions?.available !== false;
  const voiceRepliesAllowed =
    (voicePrefs?.voice_replies ?? true) && (voicePrefs?.voice_enabled ?? true);
  const usageData: AiUsage | undefined = usage.data;
  const limit = usageData?.daily.limit_reached
    ? usageData.daily
    : usageData?.monthly.limit_reached
      ? usageData.monthly
      : null;
  const conv: Conversation | undefined = conversation.data;

  const disabledReason = !online
    ? 'You’re offline. Your message is kept here until you reconnect.'
    : !consent
      ? 'Allow AI processing to send messages.'
      : null;

  if (loadState === 'missing') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Conversation not found</h1>
        <p className="text-sm text-muted">
          It may have been deleted, or it expired if it was a temporary chat.
        </p>
        <Link href="/app/chat" className="landing-btn-primary h-11 !py-0 text-sm">
          Start a new chat
        </Link>
      </div>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={conv?.title ?? 'New conversation'}
    >
      <header className="flex min-h-14 items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          {conversationId ? (conv?.title ?? ' ') : 'New conversation'}
        </h1>
        {conv?.mode === 'ephemeral' ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted">
            <IconClock width={13} height={13} /> Temporary
          </span>
        ) : null}
        {usageData?.gateway_mode === 'mock' ? (
          <span
            className="inline-flex shrink-0 items-center rounded-full border border-[var(--karen-warning)] px-2 py-0.5 text-xs font-medium text-[var(--karen-warning)]"
            title="This environment uses a local test model. Replies are not real AI answers."
          >
            Test mode
          </span>
        ) : null}
      </header>

      {!online ? (
        <StatusStrip tone="warning">
          You’re offline. We’ll reconnect and continue automatically.
        </StatusStrip>
      ) : connection === 'reconnecting' && generating ? (
        <StatusStrip tone="info">Connection interrupted — reconnecting…</StatusStrip>
      ) : null}

      <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          {loadState === 'loading' ? (
            <ul aria-label="Loading messages" className="space-y-6">
              {[0, 1, 2].map((i) => (
                <li
                  key={i}
                  className={`h-14 animate-pulse rounded-[var(--karen-radius-lg)] bg-[var(--karen-surface-raised)] motion-reduce:animate-none ${i % 2 ? 'ml-auto w-2/3' : 'w-5/6'}`}
                />
              ))}
            </ul>
          ) : loadState === 'error' ? (
            <div
              role="alert"
              className="space-y-2 rounded-[var(--karen-radius-md)] border border-[var(--karen-danger)] p-4 text-sm"
            >
              <p className="font-medium">We couldn’t load this conversation.</p>
              <p className="text-muted">
                {errorMessage(loadError)}{' '}
                {loadError?.correlation_id ? `Reference: ${loadError.correlation_id}` : null}
              </p>
              <button type="button" className="underline" onClick={() => window.location.reload()}>
                Try again
              </button>
            </div>
          ) : visible.length === 0 ? (
            <Welcome
              newChat={!conversationId}
              ephemeral={ephemeral}
              setEphemeral={setEphemeral}
              onPick={(s) => setDraft(s)}
            />
          ) : (
            <>
              {state.olderCursor ? (
                <div className="mb-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadOlder()}
                    disabled={loadingOlder}
                    className="min-h-11 rounded-full border border-border px-4 text-sm text-muted hover:text-foreground"
                  >
                    {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                  </button>
                </div>
              ) : null}
              <ul role="log" aria-label="Messages" aria-live="off" className="space-y-6">
                {visible.map((m) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    animate={!reduceMotion && liveIds.has(m.id)}
                    canRegenerate={latest?.id === m.id && !generating}
                    busy={busy}
                    actions={{
                      notify,
                      onRegenerate: () => void regenerate(m),
                      onFeedback: (rating, category) =>
                        void feedback(m, () =>
                          chatApi.feedback(conversationId!, m.id, {
                            rating,
                            ...(category ? { category } : {}),
                          }),
                        ),
                      onClearFeedback: () =>
                        void feedback(m, () => chatApi.clearFeedback(conversationId!, m.id)),
                      ...(consent ? { onEdit: (content: string) => void fork(m, content) } : {}),
                      ...(consent && m.role === 'assistant' && voiceRepliesAllowed
                        ? { onListen: () => listen(m.id), speaking: speakingId === m.id }
                        : {}),
                    }}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
        {!atBottom ? (
          <button
            type="button"
            onClick={jumpToLatest}
            className="sticky bottom-3 left-1/2 mx-auto flex min-h-10 -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-[var(--karen-surface)] px-4 text-sm shadow-md hover:bg-[var(--karen-surface-raised)]"
          >
            <IconArrowDown width={15} height={15} /> Jump to latest
          </button>
        ) : null}
      </div>

      <div className="border-t border-border bg-[var(--karen-background)] px-4 pt-3 pb-4">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          {!consent ? (
            <ConsentCard
              onAllow={() => void grantConsent()}
              busy={busy}
              noticeAvailable={gate.privacyNoticeVersion !== null}
            />
          ) : null}
          {limit && !banner ? (
            <StatusStrip tone="warning" rounded>
              You’ve reached your chat limit for now. It resets {fmtTime(new Date(limit.resets_at))}
              .
            </StatusStrip>
          ) : null}
          {banner ? (
            <div
              role={banner.tone === 'danger' ? 'alert' : 'status'}
              className={`flex items-start justify-between gap-3 rounded-[var(--karen-radius-md)] border px-3 py-2 text-sm ${
                banner.tone === 'danger'
                  ? 'border-[var(--karen-danger)] text-[var(--karen-danger)]'
                  : banner.tone === 'warning'
                    ? 'border-[var(--karen-warning)] text-[var(--karen-warning)]'
                    : 'border-border text-muted'
              }`}
            >
              <span>{banner.text}</span>
              <button
                type="button"
                className="shrink-0 text-xs underline"
                onClick={() => setBanner(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
          {showVoiceMode && consent && voiceInputAllowed && liveSupported ? (
            <VoiceMode
              state={liveState}
              wakeStatus={wakeAllowed ? wakeStatus : null}
              suggestions={SUGGESTIONS}
              onOrb={onOrb}
              onClose={closeVoiceMode}
              onSuggestion={conversationId ? askAloud : null}
            />
          ) : null}
          {consent && voiceInputAllowed && liveSupported && voiceOptions?.live_available ? (
            <LiveVoicePanel
              state={liveState}
              partial={livePartial}
              isMock={liveMock}
              active={liveState !== 'idle'}
              onStart={() => {
                setVoiceModeOpen(true);
                void startLive();
              }}
              onStop={() => void stopLive()}
              wake={
                wakeSupported
                  ? { on: wakeOn, status: wakeAllowed ? wakeStatus : null, onToggle: toggleWake }
                  : null
              }
            />
          ) : null}
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            onStop={() => void stop()}
            generating={generating}
            busy={busy}
            disabledReason={disabledReason}
            autoFocus={consent}
            {...(consent && voiceSupported && voiceInputAllowed && liveState === 'idle'
              ? {
                  voice: {
                    state: voiceState,
                    seconds: voiceSeconds,
                    onStart: () => void startVoice(),
                    onStop: () => void stopVoice(),
                    onCancel: cancelVoice,
                  },
                }
              : {})}
          />
          <AiDisclosure disclosure={gate.aiDisclosure} />
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}

function StatusStrip({
  tone,
  children,
  rounded,
}: {
  tone: 'warning' | 'info';
  children: ReactNode;
  rounded?: boolean;
}) {
  return (
    <p
      role="status"
      className={`px-4 py-2 text-center text-sm ${rounded ? 'rounded-[var(--karen-radius-md)] border' : 'border-b'} ${
        tone === 'warning'
          ? 'border-[var(--karen-warning)] text-[var(--karen-warning)]'
          : 'border-border text-muted'
      }`}
    >
      {children}
    </p>
  );
}

function Welcome({
  newChat,
  ephemeral,
  setEphemeral,
  onPick,
}: {
  newChat: boolean;
  ephemeral: boolean;
  setEphemeral: (v: boolean) => void;
  onPick: (s: string) => void;
}) {
  return (
    <div className="space-y-6 py-6 text-center">
      <div className="space-y-2">
        <div
          aria-hidden
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-gradient-to-br from-[var(--karen-ribbon-cool-from)] to-[var(--karen-ribbon-cool-to)] text-lg font-semibold text-white shadow-md"
        >
          K
        </div>
        <h2 className="text-xl font-semibold">How can I help today?</h2>
        <p className="mx-auto max-w-md text-sm text-muted">
          Ask in English, Hindi or Hinglish. KAREN can explain, draft, plan and think things through
          with you. It can’t take actions or look things up on the web yet.
        </p>
      </div>
      <ul className="mx-auto grid max-w-2xl gap-2 text-left sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="min-h-14 w-full rounded-[var(--karen-radius-md)] border border-border bg-[var(--karen-surface)] px-4 py-3 text-left text-sm transition-colors hover:border-[var(--karen-accent)] focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
      {newChat ? (
        <label className="mx-auto flex max-w-md items-start gap-3 rounded-[var(--karen-radius-md)] border border-border p-3 text-left text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={ephemeral}
            onChange={(e) => setEphemeral(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--karen-accent)]"
          />
          <span>
            <span className="font-medium">Temporary chat</span>
            <span className="block text-xs text-muted">
              Deleted automatically after 24 hours. KAREN still processes what you send to answer
              it.
            </span>
          </span>
        </label>
      ) : null}
    </div>
  );
}

function ConsentCard({
  onAllow,
  busy,
  noticeAvailable,
}: {
  onAllow: () => void;
  busy: boolean;
  noticeAvailable: boolean;
}) {
  return (
    <div
      role="region"
      aria-label="Permission needed"
      className="space-y-3 rounded-[var(--karen-radius-lg)] border border-[var(--karen-accent)] bg-[var(--karen-surface)] p-4"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Allow AI processing to chat</h2>
        <p className="text-sm text-muted">
          To answer, KAREN sends what you type in this chat to an AI model. Nothing is shared for
          advertising, and you can turn this off any time in Privacy &amp; data. Your past
          conversations stay readable and deletable either way.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAllow}
          disabled={busy || !noticeAvailable}
          className="landing-btn-primary h-11 !py-0 text-sm"
        >
          Allow AI processing
        </button>
        <Link href="/app/settings/privacy" className="landing-btn-ghost h-11 !py-0 text-sm">
          Review in Privacy &amp; data
        </Link>
      </div>
      {!noticeAvailable ? (
        <p className="text-xs text-muted">
          A privacy notice must be published before this can be recorded.
        </p>
      ) : null}
    </div>
  );
}

function AiDisclosure({ disclosure }: { disclosure: ChatGateProps['aiDisclosure'] }) {
  return (
    <details className="group text-center text-xs text-muted">
      <summary className="mx-auto w-fit cursor-pointer list-none rounded px-1 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--karen-focus-ring)]">
        AI answers can be wrong. KAREN can’t take actions or browse the web yet.{' '}
        <span className="underline">About AI answers</span>
      </summary>
      <div className="mt-2 max-h-48 overflow-y-auto rounded-[var(--karen-radius-md)] border border-border p-3 text-left whitespace-pre-wrap">
        {disclosure ? (
          <>
            {disclosure.draft ? (
              <strong className="block pb-1">Draft notice — not legally reviewed.</strong>
            ) : null}
            {disclosure.content}
          </>
        ) : (
          'The AI disclosure notice is not available right now.'
        )}
      </div>
    </details>
  );
}
