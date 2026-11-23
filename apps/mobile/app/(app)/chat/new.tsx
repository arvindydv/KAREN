import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Caption, SpaceBackground } from '../../../src/components/primitives';
import { ActionSheet } from '../../../src/features/chat/action-sheet';
import { StarField } from '../../../src/features/chat/assistant-orb';
import { ChatHeader, ListGlyph, useKeyboardVisible } from '../../../src/features/chat/chat-chrome';
import { ChatWelcome, SuggestionCards } from '../../../src/features/chat/chat-welcome';
import { Composer } from '../../../src/features/chat/composer';
import { ConsentRequired, useAiConsent } from '../../../src/features/chat/consent-gate';
import { ApiRequestError, NetworkError, describeError } from '../../../src/lib/api-error';
import { useAiUsage, useChatActions, usageResetTime } from '../../../src/lib/chat-queries';
import {
  qk,
  useInvalidate,
  usePreferences,
  useProfile,
  useVoiceOptions,
} from '../../../src/lib/queries';
import { voiceSupport } from '../../../src/features/voice/native-modules';
import {
  VOICE_NOT_IN_BUILD,
  useVoiceAssistant,
} from '../../../src/features/voice/use-voice-assistant';
import { VoiceBar } from '../../../src/features/voice/voice-bar';
import { VoiceMode } from '../../../src/features/voice/voice-mode';
import { useVoiceStore } from '../../../src/state/voice-store';
import { newUuid } from '../../../src/lib/uuid';
import { useChatDrafts } from '../../../src/state/chat-drafts';
import { useTheme } from '../../../src/theme/theme';

const DRAFT_KEY = 'new';
const NO_MESSAGES: never[] = [];

/**
 * The signed-in landing screen: a fresh chat with KAREN. No conversation is created until the
 * user actually sends something (so opening the app never leaves empty chats behind); the
 * first send creates it and moves to `/chat/<id>`, where the answer streams in.
 */
export default function NewChatScreen() {
  const t = useTheme();
  const router = useRouter();
  const actions = useChatActions();
  const consent = useAiConsent();
  const usage = useAiUsage();
  const profile = useProfile();
  const invalidate = useInvalidate();
  const keyboardVisible = useKeyboardVisible();
  const draft = useChatDrafts((s) => s.drafts[DRAFT_KEY] ?? '');
  const setDraft = useChatDrafts((s) => s.setDraft);
  const clearDraft = useChatDrafts((s) => s.clearDraft);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [problem, setProblem] = useState<{ text: string; tone: 'warning' | 'info' } | null>(null);
  /** Survives a failed send so a retry reuses the same chat and Idempotency-Key. */
  const pending = useRef<{ text: string; key: string; conversationId: string | null } | null>(null);
  const name = profile.data?.preferred_name ?? profile.data?.display_name ?? null;

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if (!text || sending) return;
      if (pending.current?.text !== text) {
        pending.current = { text, key: newUuid(), conversationId: null };
      }
      const attempt = pending.current;
      setSending(true);
      setProblem(null);
      try {
        attempt.conversationId ??= (await actions.create('standard')).id;
        await actions.send(attempt.conversationId, text, attempt.key);
        pending.current = null;
        if (override === undefined) clearDraft(DRAFT_KEY);
        router.replace(`/chat/${attempt.conversationId}`);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'CONSENT_REQUIRED') {
          await invalidate(qk.consents);
        }
        const reset = usageResetTime(err);
        setProblem(
          reset
            ? {
                tone: 'warning',
                text: `You’ve reached your chat limit for now. It resets ${new Intl.DateTimeFormat(
                  'en-IN',
                  { dateStyle: 'medium', timeStyle: 'short' },
                ).format(reset)}.`,
              }
            : err instanceof NetworkError
              ? {
                  tone: 'warning',
                  text: 'You’re offline. Your message is kept — tap Send to try again.',
                }
              : { tone: 'warning', text: describeError(err) },
        );
        void usage.refetch();
      } finally {
        setSending(false);
      }
    },
    [actions, clearDraft, draft, invalidate, router, sending, usage],
  );

  // ---- Talking to KAREN (ADR-0030). This screen only listens for "Hey KAREN" (or the mic tap);
  // it then creates a chat and hands the conversation to the chat screen.
  const voiceOptions = useVoiceOptions();
  const preferences = usePreferences();
  const voiceAllowed =
    consent === true &&
    (preferences.data?.voice_enabled ?? true) &&
    voiceOptions.data?.available === true;
  const starting = useRef(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const startVoiceChat = useCallback(
    async (question: string | null) => {
      if (starting.current) return;
      if (!voiceAllowed) {
        setProblem({
          tone: 'info',
          text:
            preferences.data?.voice_enabled === false
              ? 'Voice is turned off. Turn it on in Settings → Preferences to talk to KAREN.'
              : 'Talking to KAREN isn’t available right now. Please type instead.',
        });
        return;
      }
      if (!voiceSupport.talk) {
        setProblem({ tone: 'info', text: VOICE_NOT_IN_BUILD });
        return;
      }
      starting.current = true;
      setVoiceMode(true); // the orb screen appears at once; the chat opens behind it
      try {
        const chat = await actions.create('standard');
        useVoiceStore.getState().setHandoff({ conversationId: chat.id, question });
        router.replace(`/chat/${chat.id}`);
      } catch (err) {
        setVoiceMode(false);
        setProblem({ tone: 'warning', text: describeError(err) });
      } finally {
        starting.current = false;
      }
    },
    [actions, preferences.data?.voice_enabled, router, voiceAllowed],
  );
  const voice = useVoiceAssistant({
    conversationId: null,
    messages: NO_MESSAGES,
    allowed: voiceAllowed,
    handoff: (question) => {
      void startVoiceChat(question);
      return true;
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <SpaceBackground />
      <StarField />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ChatHeader
            title="KAREN"
            backLabel="All chats"
            onBack={() => router.push('/chat')}
            left={<ListGlyph color={t.colors.textPrimary} />}
            menuLabel="More options"
            onMenu={() => setMenu(true)}
          />
          <ChatWelcome
            name={name}
            compact={keyboardVisible}
            {...(voiceAllowed && voice.supported
              ? { onTalk: () => void startVoiceChat(null) }
              : {})}
          />
          {consent === true ? (
            <View style={{ paddingBottom: t.spacing.sm }}>
              <SuggestionCards disabled={sending} onPick={(s) => void send(s.prompt)} />
            </View>
          ) : null}
          <View
            style={{
              paddingHorizontal: t.spacing.lg,
              paddingBottom: keyboardVisible ? t.spacing.sm : t.spacing.md,
              gap: 8,
            }}
          >
            {problem ? <Banner tone={problem.tone}>{problem.text}</Banner> : null}
            {voice.notice ? <Banner tone="info">{voice.notice}</Banner> : null}
            {voiceAllowed && voice.supported ? (
              <VoiceBar
                state={voice.state}
                handsFree={voice.handsFree}
                wakeAvailable={voice.wakeAvailable}
                onTalk={() => void startVoiceChat(null)}
                onHandsFree={(on) => void voice.setHandsFree(on)}
              />
            ) : null}
            {consent === false ? (
              <ConsentRequired />
            ) : (
              <Composer
                value={draft}
                onChange={(text) => setDraft(DRAFT_KEY, text)}
                onSend={() => void send()}
                onStop={() => undefined}
                onMic={() => void startVoiceChat(null)}
                generating={false}
                disabled={consent !== true || sending}
                disabledReason={consent !== true ? 'AI processing is not allowed' : 'Sending'}
              />
            )}
            {keyboardVisible ? null : (
              <Caption>
                {usage.data?.gateway_mode === 'mock'
                  ? 'Test environment: replies are labelled test replies, not AI answers. '
                  : ''}
                KAREN can make mistakes and can’t take actions or remember other chats yet.
              </Caption>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      {voiceMode ? (
        <VoiceMode
          state={{ ...voice.state, phase: 'thinking' }}
          name={name}
          notice={null}
          handsFree={voice.handsFree}
          wakeAvailable={voice.wakeAvailable}
          onOrb={() => undefined}
          onClose={() => setVoiceMode(false)}
          onSuggestion={(s) => void startVoiceChat(s.prompt)}
          onHandsFree={(on) => void voice.setHandsFree(on)}
        />
      ) : null}
      <ActionSheet
        visible={menu}
        title="KAREN"
        options={[
          { label: 'All chats', onPress: () => router.push('/chat') },
          { label: 'Settings', onPress: () => router.push('/settings') },
          { label: 'Account & setup', onPress: () => router.push('/home') },
        ]}
        onClose={() => setMenu(false)}
      />
    </View>
  );
}
