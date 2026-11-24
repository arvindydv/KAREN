import type { MemoryItem, MemoryStatusResponse } from '@karen/api-contracts';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, View } from 'react-native';
import {
  Banner,
  Body,
  Caption,
  ChoiceGroup,
  DangerLink,
  EmptyState,
  ErrorState,
  FormScreen,
  LinkRow,
  ListCard,
  Pill,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  TextButton,
  TextField,
  ToggleRow,
} from '../../../../src/components/primitives';
import { QueryView } from '../../../../src/components/query-view';
import { ScreenHeader } from '../../../../src/components/screen-header';
import { KIND_LABEL, MEMORY_COPY } from '../../../../src/features/memory/copy';
import { describeError } from '../../../../src/lib/api-error';
import {
  type MemoryFilter,
  useMemories,
  useMemoryActions,
  useMemorySettings,
  useMemoryStatus,
} from '../../../../src/lib/memory-queries';
import { useSubmit } from '../../../../src/lib/use-submit';
import { useTheme } from '../../../../src/theme/theme';

const KINDS = [
  { value: 'all', label: 'All' },
  { value: 'fact', label: 'Facts' },
  { value: 'preference', label: 'Preferences' },
  { value: 'context', label: 'Plans' },
  { value: 'event', label: 'Events' },
] as const;

/**
 * Settings › Memory (Phase 03 M6; arch §3.3–§3.6). Everything shown comes from the server: the
 * feature flag, the consent state and the counts are never guessed on the device (SR-UI-01).
 * No retention duration or purge date is ever rendered (H6).
 */
export default function MemoryScreen() {
  const status = useMemoryStatus();
  return (
    <FormScreen>
      <ScreenHeader title={MEMORY_COPY.title} />
      <QueryView query={status} loadingLabel="Loading memory">
        {(s) => (s.feature_enabled ? <MemoryHome status={s} /> : <FeatureOff />)}
      </QueryView>
    </FormScreen>
  );
}

function FeatureOff() {
  return <EmptyState title={MEMORY_COPY.featureOff} message={MEMORY_COPY.featureOffDetail} />;
}

function MemoryHome({ status }: { status: MemoryStatusResponse }) {
  const router = useRouter();
  const [filter, setFilter] = useState<MemoryFilter>({ q: '', status: 'all' });
  const list = useMemories(filter);
  const actions = useMemoryActions();
  const settings = useMemorySettings();
  const [problem, setProblem] = useState<string | null>(null);
  const guard = (fn: () => Promise<unknown>) => () =>
    void fn().catch((err: unknown) => setProblem(describeError(err)));

  const exporter = useSubmit(
    useCallback(async () => {
      const data = await actions.exportAll();
      // The user chooses where it goes (OS share sheet); nothing is written to device storage.
      await Share.share({ message: JSON.stringify(data, null, 2), title: 'KAREN memories' });
    }, [actions]),
  );

  const confirmClear = () =>
    Alert.alert(MEMORY_COPY.clearAllTitle, MEMORY_COPY.clearAllBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete all',
        style: 'destructive',
        onPress: guard(() => actions.clear({ scope: 'all' })),
      },
    ]);
  const confirmDeleteSuspended = () =>
    Alert.alert(MEMORY_COPY.clearAllTitle, MEMORY_COPY.clearAllBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: guard(() => actions.clear({ scope: 'all' })),
      },
    ]);

  return (
    <View style={{ gap: 16 }}>
      {problem ? <Banner tone="warning">{problem}</Banner> : null}
      {status.consent === 'not_granted' ? (
        <Banner tone="info">{`${MEMORY_COPY.consentOff} ${MEMORY_COPY.consentOffDetail}`}</Banner>
      ) : null}
      {status.consent === 'reconfirm_required' ? (
        <View style={{ gap: 8 }}>
          <Banner tone="warning">{`${MEMORY_COPY.reconfirm} ${MEMORY_COPY.reconfirmDetail}`}</Banner>
          <SecondaryButton
            label="Review in Privacy"
            onPress={() => router.push('/settings/privacy')}
          />
        </View>
      ) : null}

      {status.counts.suspended > 0 ? (
        <View
          accessible
          accessibilityRole="summary"
          accessibilityLabel={MEMORY_COPY.suspendedTitle(status.counts.suspended)}
          style={{ gap: 8 }}
        >
          <Banner tone="warning">
            {`${MEMORY_COPY.suspendedTitle(status.counts.suspended)} ${MEMORY_COPY.suspendedDetail}`}
          </Banner>
          <PrimaryButton
            label={MEMORY_COPY.restore}
            disabled={status.consent !== 'eligible'}
            hint={status.consent !== 'eligible' ? MEMORY_COPY.consentOffDetail : undefined}
            onPress={guard(() => actions.restore())}
          />
          <SecondaryButton
            label={MEMORY_COPY.deleteNow}
            destructive
            onPress={confirmDeleteSuspended}
          />
        </View>
      ) : null}

      <ListCard>
        <LinkRow
          label={MEMORY_COPY.suggestions(status.counts.pending_suggestions)}
          description={MEMORY_COPY.suggestionsDetail}
          onPress={() => router.push('/settings/memory/suggestions')}
        />
      </ListCard>

      <TextField
        label={MEMORY_COPY.searchLabel}
        value={filter.q}
        onChangeText={(q) => setFilter((f) => ({ ...f, q }))}
        autoCapitalize="none"
        returnKeyType="search"
      />
      <ChoiceGroup
        label="Show"
        options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
        value={filter.kind ?? 'all'}
        onChange={(v) => setFilter((f) => ({ ...f, kind: v === 'all' ? undefined : v }))}
      />

      <QueryView query={list} loadingLabel="Loading memories">
        {(data) => {
          const items = data.pages.flatMap((p) => p.items);
          if (items.length === 0) {
            return <EmptyState title={MEMORY_COPY.empty} message={MEMORY_COPY.emptyDetail} />;
          }
          return (
            <View style={{ gap: 8 }}>
              <ListCard>
                {items.map((m) => (
                  <MemoryRow
                    key={m.id}
                    item={m}
                    onPress={() => router.push(`/settings/memory/${m.id}`)}
                  />
                ))}
              </ListCard>
              {list.hasNextPage ? (
                <TextButton label="Show more" onPress={() => void list.fetchNextPage()} />
              ) : null}
            </View>
          );
        }}
      </QueryView>

      <SectionTitle>Settings</SectionTitle>
      {settings.isError ? (
        <ErrorState
          message={describeError(settings.error)}
          onRetry={() => void settings.refetch()}
        />
      ) : settings.data ? (
        <ToggleRow
          label={MEMORY_COPY.askBeforeSaving}
          description={MEMORY_COPY.askBeforeSavingDetail}
          value={settings.data.ask_before_saving}
          onChange={(v) => guard(() => actions.setAskBeforeSaving(settings.data, v))()}
        />
      ) : null}
      <Caption>{MEMORY_COPY.help}</Caption>

      <SecondaryButton
        label={exporter.busy ? 'Preparing…' : MEMORY_COPY.exportLabel}
        disabled={exporter.busy}
        onPress={() => exporter.run()}
      />
      {exporter.error ? <Banner tone="warning">{describeError(exporter.error)}</Banner> : null}
      <DangerLink label={MEMORY_COPY.clearAll} onPress={confirmClear} />
    </View>
  );
}

function MemoryRow({ item, onPress }: { item: MemoryItem; onPress: () => void }) {
  const t = useTheme();
  const label = [
    item.text,
    KIND_LABEL[item.kind] ?? item.kind,
    item.pinned ? MEMORY_COPY.pinned : null,
    item.status === 'suspended' ? MEMORY_COPY.suspended : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: t.minTouchTarget, gap: 4, paddingVertical: 6 }}
    >
      <Body>{item.text}</Body>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Pill label={KIND_LABEL[item.kind] ?? item.kind} />
        {item.pinned ? <Pill label={MEMORY_COPY.pinned} tone="accent" /> : null}
        {item.status === 'suspended' ? <Pill label={MEMORY_COPY.suspended} /> : null}
      </View>
    </Pressable>
  );
}
