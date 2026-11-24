import type { MemoryItem } from '@karen/api-contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import {
  Banner,
  Body,
  Caption,
  DangerLink,
  FormScreen,
  GlassCard,
  Pill,
  PrimaryButton,
  SecondaryButton,
  TextField,
  ToggleRow,
} from '../../../../src/components/primitives';
import { QueryView } from '../../../../src/components/query-view';
import { ScreenHeader } from '../../../../src/components/screen-header';
import { KIND_LABEL, MEMORY_COPY } from '../../../../src/features/memory/copy';
import { describeError } from '../../../../src/lib/api-error';
import { formatDate } from '../../../../src/lib/format';
import { useMemoryActions, useMemoryItem } from '../../../../src/lib/memory-queries';

/** One memory: provenance, correct, pin, restore, delete (arch §3.6, §4.5). */
export default function MemoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const item = useMemoryItem(id);
  return (
    <FormScreen>
      <ScreenHeader title="Memory" />
      <QueryView query={item} loadingLabel="Loading memory">
        {(m) => <MemoryDetail item={m} />}
      </QueryView>
    </FormScreen>
  );
}

/** Provenance line (dates the user said / confirmed it — never a purge date). */
export function provenanceText(m: MemoryItem): string {
  const said = formatDate(m.provenance.said_at);
  const confirmed = formatDate(m.provenance.confirmed_at);
  const base =
    m.origin === 'explicit_request'
      ? MEMORY_COPY.provenance.explicit_request(said)
      : m.origin === 'confirmed_suggestion'
        ? MEMORY_COPY.provenance.confirmed_suggestion(confirmed)
        : MEMORY_COPY.provenance.user_created(said);
  return m.provenance.edited_at
    ? `${base}${MEMORY_COPY.provenance.edited(formatDate(m.provenance.edited_at))}`
    : base;
}

function MemoryDetail({ item }: { item: MemoryItem }) {
  const router = useRouter();
  const actions = useMemoryActions();
  const [text, setText] = useState(item.text);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suspended = item.status === 'suspended';
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
  const confirmDelete = () =>
    Alert.alert(MEMORY_COPY.deleteOneTitle, MEMORY_COPY.deleteOneBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void act(async () => {
            await actions.remove(item.id);
            router.back();
          }),
      },
    ]);

  return (
    <View style={{ gap: 16 }}>
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
      <GlassCard>
        <Body>{item.text}</Body>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <Pill label={KIND_LABEL[item.kind] ?? item.kind} />
          {item.subject_label ? <Pill label={`About: ${item.subject_label}`} /> : null}
          {suspended ? <Pill label={MEMORY_COPY.suspended} /> : null}
        </View>
        <Caption>{provenanceText(item)}</Caption>
        {item.provenance.source_excerpt && item.provenance.source_excerpt !== item.text ? (
          <Caption>{`From: “${item.provenance.source_excerpt}”`}</Caption>
        ) : null}
      </GlassCard>

      {suspended ? (
        <View style={{ gap: 8 }}>
          <Banner tone="warning">{MEMORY_COPY.suspendedDetail}</Banner>
          <PrimaryButton
            label={MEMORY_COPY.restore}
            busy={busy}
            onPress={() => void act(() => actions.restore([item.id]))}
          />
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          <TextField
            label="Correct this memory"
            value={text}
            onChangeText={setText}
            maxLength={280}
            multiline
          />
          <SecondaryButton
            label={busy ? 'Saving…' : 'Save correction'}
            disabled={busy || text.trim() === item.text || text.trim() === ''}
            onPress={() => void act(() => actions.update(item, { text: text.trim() }))}
          />
          <ToggleRow
            label={MEMORY_COPY.pinned}
            description="Pinned memories are always available to KAREN"
            value={item.pinned}
            disabled={busy}
            onChange={(v) => void act(() => actions.update(item, { pinned: v }))}
          />
        </View>
      )}
      <DangerLink label="Delete this memory" onPress={confirmDelete} disabled={busy} />
    </View>
  );
}
