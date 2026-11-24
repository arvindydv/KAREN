import type { MemorySuggestion } from '@karen/api-contracts';
import { useState } from 'react';
import { View } from 'react-native';
import {
  Banner,
  Body,
  Caption,
  EmptyState,
  FormScreen,
  GlassCard,
  Pill,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from '../../../../src/components/primitives';
import { QueryView } from '../../../../src/components/query-view';
import { ScreenHeader } from '../../../../src/components/screen-header';
import { KIND_LABEL, MEMORY_COPY } from '../../../../src/features/memory/copy';
import { describeError } from '../../../../src/lib/api-error';
import { formatDate } from '../../../../src/lib/format';
import { useMemoryActions, useSuggestions } from '../../../../src/lib/memory-queries';

const REASON: Record<string, string> = {
  stated: 'You mentioned this',
  third_party: 'About someone else — needs your confirmation',
  conflict: 'Different from a memory you already have',
  ask_before_saving: 'You asked KAREN to check before saving',
  restore_conflict: 'From before you turned memory off — conflicts with a newer memory',
};

/** Suggestions inbox (tier 2, D7): confirm (optionally corrected) or dismiss. */
export default function SuggestionsScreen() {
  const suggestions = useSuggestions();
  return (
    <FormScreen>
      <ScreenHeader title={MEMORY_COPY.suggestions(0)} />
      <QueryView query={suggestions} loadingLabel="Loading suggestions">
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState title={MEMORY_COPY.noSuggestions} />
          ) : (
            <View style={{ gap: 12 }}>
              {d.items.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
            </View>
          )
        }
      </QueryView>
    </FormScreen>
  );
}

function SuggestionCard({ suggestion }: { suggestion: MemorySuggestion }) {
  const actions = useMemoryActions();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggestion.text);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setProblem(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setProblem(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <GlassCard>
      <Body>{suggestion.text}</Body>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginVertical: 6 }}>
        <Pill label={KIND_LABEL[suggestion.kind] ?? suggestion.kind} />
        {suggestion.subject_label ? <Pill label={`About: ${suggestion.subject_label}`} /> : null}
      </View>
      <Caption>{`${REASON[suggestion.reason] ?? ''} · said ${formatDate(suggestion.said_at)}`}</Caption>
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
      {editing ? (
        <TextField
          label="Correct before saving"
          value={text}
          onChangeText={setText}
          maxLength={280}
          multiline
        />
      ) : null}
      <View style={{ gap: 8, marginTop: 8 }}>
        <PrimaryButton
          label="Remember this"
          busy={busy}
          disabled={busy || text.trim() === ''}
          onPress={() =>
            void act(() =>
              actions.confirm(
                suggestion.id,
                editing && text.trim() !== suggestion.text ? text.trim() : undefined,
              ),
            )
          }
        />
        {!editing ? (
          <SecondaryButton
            label="Correct it first"
            onPress={() => setEditing(true)}
            disabled={busy}
          />
        ) : null}
        <SecondaryButton
          label="Don’t remember"
          disabled={busy}
          onPress={() => void act(() => actions.dismiss(suggestion.id))}
        />
      </View>
    </GlassCard>
  );
}
