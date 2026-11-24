import type { Conversation, MemoryActivity } from '@karen/api-contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinkRow, ListCard, ToggleRow } from '../../components/primitives';
import { describeError } from '../../lib/api-error';
import { useChatActions } from '../../lib/chat-queries';
import { useMemoryActions, useMemoryActivity } from '../../lib/memory-queries';
import { useTheme } from '../../theme/theme';
import { MEMORY_COPY } from './copy';

/**
 * Chat header memory status (D8 owner condition, arch §3.5) + per-thread switch. The label is the
 * server's `memory_status` verbatim — never computed on the device. Hidden when the feature is off.
 */
export function ChatMemoryBar({ conversation }: { conversation: Conversation }) {
  const t = useTheme();
  const router = useRouter();
  const actions = useChatActions();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const status = conversation.memory_status;
  if (!status || status === 'off_feature') return null;
  const label = MEMORY_COPY.status[status] ?? MEMORY_COPY.status.unavailable!;
  const canToggle = conversation.mode === 'standard';
  return (
    <View style={{ paddingHorizontal: t.spacing.lg, gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. Memory options`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{
          alignSelf: 'flex-start',
          minHeight: t.minTouchTarget,
          justifyContent: 'center',
          paddingHorizontal: 12,
          borderRadius: t.radius.pill,
          borderWidth: 1,
          borderColor: status === 'on' ? t.colors.highlight : t.glass.border,
        }}
      >
        <Text style={{ color: t.colors.textPrimary }}>{label}</Text>
      </Pressable>
      {open ? (
        <ListCard>
          {canToggle ? (
            <ToggleRow
              label={MEMORY_COPY.useInThisChat}
              value={conversation.memory_enabled}
              onChange={(v) => {
                setProblem(null);
                void actions
                  .update(conversation, { memory_enabled: v })
                  .catch((err: unknown) => setProblem(describeError(err)));
              }}
            />
          ) : null}
          {problem ? <Text style={{ color: t.colors.textSecondary }}>{problem}</Text> : null}
          <LinkRow label={MEMORY_COPY.manage} onPress={() => router.push('/settings/memory')} />
        </ListCard>
      ) : null}
    </View>
  );
}

/**
 * In-chat memory chips (§3.6): what happened to "remember …" requests in this chat since the
 * screen opened. Content-free (ids + outcome codes); Undo uses the version the server reported.
 */
export function ChatMemoryChips({
  conversation,
  since,
}: {
  conversation: Conversation;
  since: string;
}) {
  const t = useTheme();
  const router = useRouter();
  const enabled = conversation.memory_status === 'on';
  const activity = useMemoryActivity(conversation.id, enabled, since);
  const memory = useMemoryActions();
  const [undone, setUndone] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  if (!enabled || !activity.data || activity.data.items.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: t.spacing.lg, gap: 6 }}>
      {activity.data.items.slice(0, 3).map((e) => (
        <Chip
          key={e.job_id}
          entry={e}
          undone={undone.has(e.job_id)}
          onUndo={() => {
            const item = e.items[0];
            if (!item) return;
            void memory
              .undo(item.id, item.version)
              .then(() => setUndone((s) => new Set(s).add(e.job_id)))
              .catch((err: unknown) => setProblem(describeError(err)));
          }}
          onView={() => {
            const item = e.items[0];
            if (item) router.push(`/settings/memory/${item.id}`);
          }}
          onReview={() => router.push('/settings/memory/suggestions')}
        />
      ))}
      {problem ? <Text style={{ color: t.colors.textSecondary }}>{problem}</Text> : null}
    </View>
  );
}

function Chip({
  entry,
  undone,
  onUndo,
  onView,
  onReview,
}: {
  entry: MemoryActivity['items'][number];
  undone: boolean;
  onUndo: () => void;
  onView: () => void;
  onReview: () => void;
}) {
  const t = useTheme();
  const text =
    entry.status === 'pending' || entry.status === 'running'
      ? MEMORY_COPY.chip.saving
      : undone
        ? 'Removed from memory'
        : entry.stored_count > 0
          ? MEMORY_COPY.chip.saved(entry.stored_count)
          : entry.suggested_count > 0
            ? MEMORY_COPY.chip.suggested
            : entry.rejected_class
              ? (MEMORY_COPY.chip.refused[entry.rejected_class] ??
                MEMORY_COPY.chip.refused.invalid!)
              : entry.outcome_code === 'duplicate'
                ? MEMORY_COPY.chip.duplicate
                : entry.status === 'failed'
                  ? MEMORY_COPY.chip.failed
                  : null;
  if (!text) return null;
  const action = (label: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: t.minTouchTarget, justifyContent: 'center', paddingHorizontal: 8 }}
    >
      <Text style={{ color: t.colors.highlight }}>{label}</Text>
    </Pressable>
  );
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={text}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        borderRadius: t.radius.md,
        borderWidth: 1,
        borderColor: t.glass.border,
        paddingHorizontal: 10,
      }}
    >
      <Text style={{ color: t.colors.textPrimary, flexShrink: 1 }}>{text}</Text>
      {entry.stored_count > 0 && !undone && entry.status === 'completed'
        ? [action(MEMORY_COPY.chip.undo, onUndo), action(MEMORY_COPY.chip.view, onView)]
        : null}
      {entry.suggested_count > 0 && entry.stored_count === 0
        ? action(MEMORY_COPY.chip.review, onReview)
        : null}
    </View>
  );
}
