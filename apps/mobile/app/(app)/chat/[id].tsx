import { MESSAGE_MAX_CHARS, TITLE_MAX_CHARS, type Message } from '@karen/api-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, FlatList, KeyboardAvoidingView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Banner,
  Caption,
  ErrorState,
  LoadingState,
  SpaceBackground,
} from '../../../src/components/primitives';
import { ActionSheet } from '../../../src/features/chat/action-sheet';
import { StarField } from '../../../src/features/chat/assistant-orb';
import { ChatWelcome, SuggestionCards } from '../../../src/features/chat/chat-welcome';
import { ChatHeader, useKeyboardVisible } from '../../../src/features/chat/chat-chrome';
import { Composer } from '../../../src/features/chat/composer';
import { ConsentRequired, useAiConsent } from '../../../src/features/chat/consent-gate';
import { MessageBubble, type BubbleActions } from '../../../src/features/chat/message-bubble';
import { TextPrompt } from '../../../src/features/chat/text-prompt';
import { useMessageStream } from '../../../src/features/chat/use-message-stream';
import { ApiRequestError, NetworkError, describeError, isDenied } from '../../../src/lib/api-error';
import {
  flattenMessages,
  type MessagePages,
  useAiUsage,
  useChatActions,
  useConversation,
  useMessages,
  usageResetTime,
} from '../../../src/lib/chat-queries';
import { qk, useInvalidate, useProfile } from '../../../src/lib/queries';
import { newUuid } from '../../../src/lib/uuid';
import { useChatDrafts } from '../../../src/state/chat-drafts';
import { useTheme } from '../../../src/theme/theme';

const ACTIVE = ['pending', 'accepted', 'streaming'];
const localTime = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);

/** Explains a failed send/regenerate in the user's terms. */
function sendProblem(err: unknown): { text: string; tone: 'warning' | 'info' } {
  const reset = usageResetTime(err);
  if (reset) {
    return {
      tone: 'warning',
      text: `You’ve reached your chat limit for now. It resets ${localTime(reset)}.`,
    };
  }
  if (err instanceof NetworkError) {
    return {
      tone: 'warning',
      text: 'You’re offline. Your message is kept — tap Send to try again when you’re back online.',
    };
  }
  if (err instanceof ApiRequestError && err.code === 'RATE_LIMITED') {
    return { tone: 'warning', text: `${err.message} Please wait a moment and try again.` };
  }
  if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
    return { tone: 'info', text: err.message };
  }
  return { tone: 'warning', text: describeError(err) };
}

export default function ConversationScreen() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = String(id);
  const conversation = useConversation(conversationId);
  const messages = useMessages(conversationId);
  const usage = useAiUsage();
  const consent = useAiConsent();
  const invalidate = useInvalidate();
  const actions = useChatActions();
  const profile = useProfile();
  const keyboardVisible = useKeyboardVisible();
  const firstName = profile.data?.preferred_name ?? profile.data?.display_name ?? null;
  const draft = useChatDrafts((s) => s.drafts[conversationId] ?? '');
  const setDraft = useChatDrafts((s) => s.setDraft);
  const clearDraft = useChatDrafts((s) => s.clearDraft);
  const [problem, setProblem] = useState<{ text: string; tone: 'warning' | 'info' } | null>(null);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<Message | null>(null);
  /** Idempotency-Key of the send in progress: reused if the user retries the same send. */
  const pendingKey = useRef<{ text: string; key: string } | null>(null);

  const all = useMemo(
    () => flattenMessages(messages.data as MessagePages | undefined),
    [messages.data],
  );
  const visible = useMemo(() => all.filter((m) => !m.superseded), [all]);
  const active = useMemo(
    () =>
      [...visible].reverse().find((m) => m.role === 'assistant' && ACTIVE.includes(m.status)) ??
      null,
    [visible],
  );
  const latestAssistantId = useMemo(
    () => [...visible].reverse().find((m) => m.role === 'assistant')?.id ?? null,
    [visible],
  );
  const { live, connection, fatal } = useMessageStream(conversationId, active);
  const generating = active !== null && !live?.done;

  // Screen readers: announce start and end only — never every token.
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (generating && !wasGenerating.current)
      AccessibilityInfo.announceForAccessibility('KAREN is answering');
    if (!generating && wasGenerating.current)
      AccessibilityInfo.announceForAccessibility('Answer finished');
    wasGenerating.current = generating;
  }, [generating]);

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      if (!text || sending) return;
      const key = pendingKey.current?.text === text ? pendingKey.current.key : newUuid();
      pendingKey.current = { text, key };
      setSending(true);
      setProblem(null);
      try {
        await actions.send(conversationId, text, key);
        pendingKey.current = null;
        if (override === undefined) clearDraft(conversationId);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'CONSENT_REQUIRED') {
          await invalidate(qk.consents);
        }
        if (!(err instanceof NetworkError)) pendingKey.current = null;
        setProblem(sendProblem(err));
        void usage.refetch();
      } finally {
        setSending(false);
      }
    },
    [actions, clearDraft, conversationId, draft, invalidate, sending, usage],
  );

  const bubbleActions: BubbleActions = useMemo(
    () => ({
      onRegenerate: (m) => {
        setProblem(null);
        actions
          .regenerate(conversationId, m.id, newUuid())
          .catch((err: unknown) => setProblem(sendProblem(err)));
      },
      onEdit: (m) => setEditing(m),
      onFeedback: (m, fb) => {
        actions
          .feedback(conversationId, m.id, fb)
          .catch((err: unknown) => setProblem(sendProblem(err)));
      },
    }),
    [actions, conversationId],
  );

  const fork = (m: Message, content: string) => {
    setProblem(null);
    actions
      .fork(conversationId, m.id, content, newUuid())
      .then((res) => router.replace(`/chat/${res.conversation.id}`))
      .catch((err: unknown) => setProblem(sendProblem(err)));
  };

  const c = conversation.data;
  const loadError = conversation.error ?? messages.error;
  const limitReached = usage.data?.daily.limit_reached || usage.data?.monthly.limit_reached;
  const resetAt = usage.data
    ? new Date(
        usage.data.daily.limit_reached ? usage.data.daily.resets_at : usage.data.monthly.resets_at,
      )
    : null;
  const canAct = consent === true && !sending && !generating;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.background }}>
      <SpaceBackground />
      <StarField />
      <SafeAreaView style={{ flex: 1 }}>
        {/* Android draws edge-to-edge (the window no longer resizes for the keyboard), so pad
            on both platforms — otherwise the composer hides behind the keyboard. */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ChatHeader
            title={c ? (visible.length === 0 ? 'KAREN' : c.title) : ' '}
            backLabel="Back to chats"
            onBack={() => (router.canGoBack() ? router.back() : router.replace('/chat'))}
            menuLabel={`${c?.title ?? 'Conversation'}. Conversation options`}
            onMenu={() => c && setMenu(true)}
          />
          {c?.mode === 'ephemeral' && c.expires_at ? (
            <View style={{ paddingHorizontal: t.spacing.lg }}>
              <Banner>
                Temporary chat — deleted automatically {localTime(new Date(c.expires_at))}. Messages
                are still processed to answer you.
              </Banner>
            </View>
          ) : null}

          {conversation.isPending || messages.isPending ? (
            <LoadingState label="Loading conversation" />
          ) : loadError ? (
            <View style={{ padding: t.spacing.lg }}>
              <ErrorState
                message={
                  isDenied(loadError)
                    ? 'You don’t have access to this chat.'
                    : describeError(loadError)
                }
                onRetry={() => {
                  void conversation.refetch();
                  void messages.refetch();
                }}
              />
            </View>
          ) : visible.length === 0 ? (
            <ChatWelcome name={firstName} compact={keyboardVisible} />
          ) : (
            <FlatList
              style={{ flex: 1 }}
              contentContainerStyle={{
                paddingHorizontal: t.spacing.lg,
                paddingVertical: t.spacing.md,
              }}
              inverted
              data={[...visible].reverse()}
              keyExtractor={(m) => m.id}
              onEndReached={() => {
                if (messages.hasNextPage && !messages.isFetchingNextPage)
                  void messages.fetchNextPage();
              }}
              ListFooterComponent={
                messages.isFetchingNextPage ? (
                  <LoadingState label="Loading earlier messages" />
                ) : undefined
              }
              renderItem={({ item }) => (
                <MessageBubble
                  message={item}
                  live={active && item.id === active.id ? live : null}
                  isLatestAssistant={item.id === latestAssistantId}
                  canAct={canAct}
                  actions={bubbleActions}
                />
              )}
            />
          )}

          {visible.length === 0 &&
          consent === true &&
          !conversation.isPending &&
          !messages.isPending &&
          !loadError ? (
            <View style={{ paddingBottom: t.spacing.sm }}>
              <SuggestionCards disabled={!canAct} onPick={(s) => void send(s.prompt)} />
            </View>
          ) : null}

          <View
            style={{
              paddingHorizontal: t.spacing.lg,
              paddingBottom: keyboardVisible ? t.spacing.sm : t.spacing.md,
              gap: 8,
            }}
          >
            {connection === 'offline' || connection === 'reconnecting' ? (
              <Banner tone="warning">
                Connection lost — reconnecting. Nothing you’ve received is lost.
              </Banner>
            ) : null}
            {fatal ? <Banner tone="warning">{fatal}</Banner> : null}
            {problem ? <Banner tone={problem.tone}>{problem.text}</Banner> : null}
            {limitReached && resetAt && !problem ? (
              <Banner tone="warning">
                You’ve reached your chat limit for now. It resets {localTime(resetAt)}.
              </Banner>
            ) : null}
            {consent === false ? (
              <ConsentRequired />
            ) : (
              <Composer
                value={draft}
                onChange={(text) => setDraft(conversationId, text)}
                onSend={() => void send()}
                onStop={() => {
                  if (active) {
                    actions
                      .cancel(conversationId, active.id)
                      .catch((err: unknown) => setProblem(sendProblem(err)));
                  }
                }}
                generating={generating}
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

      <ActionSheet
        visible={menu}
        {...(c ? { title: c.title } : {})}
        options={
          c
            ? [
                { label: 'Rename', onPress: () => setRenaming(true) },
                {
                  label: c.pinned ? 'Unpin' : 'Pin',
                  onPress: () =>
                    void actions
                      .update(c, { pinned: !c.pinned })
                      .catch((err: unknown) => setProblem(sendProblem(err))),
                },
                {
                  label: c.archived ? 'Unarchive' : 'Archive',
                  onPress: () =>
                    void actions
                      .update(c, { archived: !c.archived })
                      .catch((err: unknown) => setProblem(sendProblem(err))),
                },
                {
                  label: 'Delete…',
                  destructive: true,
                  onPress: () =>
                    Alert.alert(
                      'Delete this conversation?',
                      'All its messages are permanently deleted.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () =>
                            void actions
                              .remove(c.id)
                              .then(() => router.replace('/chat'))
                              .catch((err: unknown) => setProblem(sendProblem(err))),
                        },
                      ],
                    ),
                },
              ]
            : []
        }
        onClose={() => setMenu(false)}
      />
      <TextPrompt
        visible={renaming}
        title="Rename chat"
        label="Title"
        initial={c?.title ?? ''}
        submitLabel="Save"
        maxLength={TITLE_MAX_CHARS}
        onSubmit={(title) => {
          if (c)
            void actions.update(c, { title }).catch((err: unknown) => setProblem(sendProblem(err)));
        }}
        onClose={() => setRenaming(false)}
      />
      <TextPrompt
        visible={editing !== null}
        title="Edit and resend"
        label="Message (starts a new chat from this point)"
        initial={editing?.content ?? ''}
        submitLabel="Send as new chat"
        maxLength={MESSAGE_MAX_CHARS}
        multiline
        onSubmit={(content) => {
          if (editing) fork(editing, content);
        }}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}
