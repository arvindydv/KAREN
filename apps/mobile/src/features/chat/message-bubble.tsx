import { FEEDBACK_CATEGORIES, type Message } from '@karen/api-contracts';
import { redactForSharing } from '@karen/domain';
import { memo, useState } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import type { LiveMessage } from '../../lib/chat-state';
import { reportError } from '../../lib/error-reporting';
import { useTheme } from '../../theme/theme';
import { ActionSheet, type SheetOption } from './action-sheet';
import { MarkdownText } from './markdown';

const CATEGORY_LABEL: Record<(typeof FEEDBACK_CATEGORIES)[number], string> = {
  wrong_fact: 'Wrong or made-up fact',
  too_slow: 'Too slow',
  language: 'Wrong language',
  unsafe_action: 'Unsafe suggestion',
  unhelpful: 'Not helpful',
  other: 'Something else',
};

export interface BubbleActions {
  onRegenerate: (m: Message) => void;
  onEdit: (m: Message) => void;
  onFeedback: (
    m: Message,
    fb: { rating: 'up' | 'down'; category?: (typeof FEEDBACK_CATEGORIES)[number] } | null,
  ) => void;
}

const share = (message: string) =>
  void Share.share({ message }).catch((err: unknown) => reportError(err, { op: 'share' }));

function statusLine(status: Message['status'], streaming: boolean): string | null {
  if (streaming) return 'KAREN is writing…';
  switch (status) {
    case 'pending':
    case 'accepted':
      return 'KAREN is thinking…';
    case 'incomplete':
      return 'Answer interrupted — what you see is partial.';
    case 'failed':
      return 'No answer.';
    case 'canceled':
      return 'You stopped this answer.';
    default:
      return null;
  }
}

/** One message. Long-press opens actions (copy/share, redacted share, regenerate, rate, edit). */
export const MessageBubble = memo(function MessageBubble({
  message,
  live,
  isLatestAssistant,
  canAct,
  actions,
}: {
  message: Message;
  live?: LiveMessage | null;
  isLatestAssistant: boolean;
  /** False while a send is in flight or consent is missing. */
  canAct: boolean;
  actions: BubbleActions;
}) {
  const t = useTheme();
  const [sheet, setSheet] = useState<'main' | 'reason' | null>(null);
  const user = message.role === 'user';
  const content = live?.content ?? message.content;
  const status = live?.status ?? message.status;
  const error = live?.error ?? message.error;
  const isMock = live?.isMock ?? message.is_mock;
  const routeTier = live?.routeTier ?? message.route_tier;
  const terminal = ['completed', 'incomplete', 'failed', 'canceled'].includes(status);
  const streaming = !user && status === 'streaming';
  const line = user ? null : statusLine(status, streaming);

  const options: SheetOption[] = [];
  if (content) {
    options.push({ label: 'Copy or share', onPress: () => share(content) });
    options.push({
      label: 'Share with personal details hidden',
      onPress: () => share(redactForSharing(content).text),
    });
  }
  if (user && canAct)
    options.push({ label: 'Edit and resend', onPress: () => actions.onEdit(message) });
  if (!user && terminal && isLatestAssistant && canAct) {
    options.push({ label: 'Regenerate answer', onPress: () => actions.onRegenerate(message) });
  }
  if (!user && terminal && status === 'completed') {
    options.push({
      label: message.feedback?.rating === 'up' ? 'Remove “good answer”' : 'Good answer',
      onPress: () =>
        actions.onFeedback(message, message.feedback?.rating === 'up' ? null : { rating: 'up' }),
    });
    options.push({ label: 'Bad answer…', onPress: () => setTimeout(() => setSheet('reason'), 0) });
  }

  const a11yLabel = `${user ? 'You' : 'KAREN'}: ${content || line || ''}`;
  return (
    <View style={{ alignItems: user ? 'flex-end' : 'flex-start', marginVertical: 6 }}>
      <Pressable
        accessibilityRole="text"
        accessibilityLabel={a11yLabel}
        accessibilityHint={options.length > 0 ? 'Long press for actions' : undefined}
        accessibilityActions={options.length > 0 ? [{ name: 'longpress', label: 'Actions' }] : []}
        onAccessibilityAction={() => setSheet('main')}
        onLongPress={() => options.length > 0 && setSheet('main')}
        delayLongPress={350}
        style={{
          maxWidth: '88%',
          backgroundColor: user ? t.colors.accent : t.glass.fill,
          borderColor: t.glass.border,
          borderWidth: user ? 0 : 1,
          borderRadius: t.radius.lg,
          paddingVertical: 10,
          paddingHorizontal: 14,
          gap: 6,
        }}
      >
        {!user && (isMock || routeTier === 'NO_MODEL') ? (
          <Text
            style={{ color: t.colors.warning, fontSize: 11, fontWeight: '700' }}
            accessibilityLabel={isMock ? 'Test reply, no AI model was used' : 'Exact answer'}
          >
            {isMock ? 'TEST REPLY — NO AI MODEL' : 'EXACT ANSWER'}
          </Text>
        ) : null}
        {content ? (
          user ? (
            <Text selectable style={{ color: t.colors.accentText, fontSize: 16, lineHeight: 22 }}>
              {content}
            </Text>
          ) : (
            <MarkdownText source={content} />
          )
        ) : null}
        {line ? (
          <Text style={{ color: t.colors.textSecondary, fontSize: 13, fontStyle: 'italic' }}>
            {line}
          </Text>
        ) : null}
        {error && status !== 'canceled' ? (
          <Text accessibilityRole="alert" style={{ color: t.colors.danger, fontSize: 13 }}>
            {error.message}
          </Text>
        ) : null}
        {message.feedback ? (
          <Text style={{ color: t.colors.textSecondary, fontSize: 12 }}>
            {message.feedback.rating === 'up' ? 'You rated this good' : 'You rated this bad'}
          </Text>
        ) : null}
      </Pressable>
      {!user && terminal && status !== 'completed' && isLatestAssistant && canAct ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Regenerate answer"
          onPress={() => actions.onRegenerate(message)}
          style={{ minHeight: t.minTouchTarget, justifyContent: 'center' }}
        >
          <Text style={{ color: t.colors.highlight, fontWeight: '600' }}>↻ Regenerate</Text>
        </Pressable>
      ) : null}
      <ActionSheet
        visible={sheet === 'main'}
        title="Message"
        options={options}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={sheet === 'reason'}
        title="What was wrong?"
        options={FEEDBACK_CATEGORIES.map((c) => ({
          label: CATEGORY_LABEL[c],
          onPress: () => actions.onFeedback(message, { rating: 'down', category: c }),
        }))}
        onClose={() => setSheet(null)}
      />
    </View>
  );
});
