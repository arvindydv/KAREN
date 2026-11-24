import { TITLE_MAX_CHARS, type Conversation } from '@karen/api-contracts';
import { useRouter } from 'expo-router';
import { confirmDeleteChat } from '../../../src/features/memory/dialogs';
import { useMemoryStatus } from '../../../src/lib/memory-queries';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import {
  Caption,
  EmptyState,
  ErrorState,
  LoadingState,
  PrimaryButton,
  Screen,
  TextButton,
  TextField,
} from '../../../src/components/primitives';
import { ScreenHeader } from '../../../src/components/screen-header';
import { ActionSheet } from '../../../src/features/chat/action-sheet';
import { TextPrompt } from '../../../src/features/chat/text-prompt';
import { describeError, isDenied } from '../../../src/lib/api-error';
import { useChatActions, useConversations } from '../../../src/lib/chat-queries';
import { useTheme } from '../../../src/theme/theme';

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : 'No messages yet';

/** Conversation list: search, pinned first, new standard/temporary chat, row actions. */
export default function ChatListScreen() {
  const t = useTheme();
  const router = useRouter();
  const actions = useChatActions();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState<'exclude' | 'only'>('exclude');
  const [menuFor, setMenuFor] = useState<Conversation | null>(null);
  const [renaming, setRenaming] = useState<Conversation | null>(null);
  const [newSheet, setNewSheet] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const list = useConversations(query, archived);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  const run = (fn: () => Promise<unknown>) => {
    setActionError(null);
    fn().catch((err: unknown) => setActionError(err));
  };

  const start = (mode: 'standard' | 'ephemeral') =>
    run(async () => {
      const c = await actions.create(mode);
      router.push(`/chat/${c.id}`);
    });

  // The memory option is offered only when the server says the feature is on.
  const memoryFeature = useMemoryStatus().data?.feature_enabled === true;
  const confirmDelete = (c: Conversation) =>
    confirmDeleteChat(memoryFeature, (deleteMemories) =>
      run(() => actions.remove(c.id, deleteMemories)),
    );

  return (
    <Screen>
      <ScreenHeader title={archived === 'only' ? 'Archived chats' : 'Chats'} />
      <PrimaryButton label="New chat" onPress={() => setNewSheet(true)} />
      <TextField
        label="Search your chats"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        returnKeyType="search"
      />
      <TextButton
        label={archived === 'only' ? 'Show active chats' : 'Show archived chats'}
        onPress={() => setArchived((a) => (a === 'only' ? 'exclude' : 'only'))}
      />
      {actionError ? <ErrorState message={describeError(actionError)} /> : null}
      {list.isPending ? (
        <LoadingState label="Loading your chats" />
      ) : list.isError ? (
        isDenied(list.error) ? (
          <ErrorState message="You don’t have access to chats." />
        ) : (
          <ErrorState message={describeError(list.error)} onRetry={() => void list.refetch()} />
        )
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={items}
          keyExtractor={(c) => c.id}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching}
              onRefresh={() => void list.refetch()}
              tintColor={t.colors.highlight}
            />
          }
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          ListEmptyComponent={
            <EmptyState
              title={query ? 'No chats match your search' : 'No chats yet'}
              {...(query ? {} : { message: 'Start one with “New chat”.' })}
            />
          }
          ListFooterComponent={
            list.isFetchingNextPage ? <LoadingState label="Loading more" /> : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}${item.pinned ? ', pinned' : ''}${item.mode === 'ephemeral' ? ', temporary' : ''}`}
              accessibilityHint="Opens the chat. Long press for more options."
              onPress={() => router.push(`/chat/${item.id}`)}
              onLongPress={() => setMenuFor(item)}
              style={({ pressed }) => ({
                minHeight: 60,
                paddingVertical: t.spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: t.glass.border,
                opacity: pressed ? 0.7 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              })}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ color: t.colors.textPrimary, fontSize: 16 }}>
                  {item.pinned ? '📌 ' : ''}
                  {item.title}
                </Text>
                <Caption>
                  {item.mode === 'ephemeral' ? 'Temporary · ' : ''}
                  {when(item.last_message_at)}
                </Caption>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`More options for ${item.title}`}
                onPress={() => setMenuFor(item)}
                style={{
                  minWidth: t.minTouchTarget,
                  minHeight: t.minTouchTarget,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: t.colors.textSecondary, fontSize: 20 }}>⋯</Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
      <ActionSheet
        visible={newSheet}
        title="New chat"
        options={[
          { label: 'Standard chat', onPress: () => start('standard') },
          {
            label: 'Temporary chat (deleted after 24 hours)',
            onPress: () => start('ephemeral'),
          },
        ]}
        onClose={() => setNewSheet(false)}
      />
      <ActionSheet
        visible={menuFor !== null}
        {...(menuFor ? { title: menuFor.title } : {})}
        options={
          menuFor
            ? [
                { label: 'Rename', onPress: () => setRenaming(menuFor) },
                {
                  label: menuFor.pinned ? 'Unpin' : 'Pin',
                  onPress: () => run(() => actions.update(menuFor, { pinned: !menuFor.pinned })),
                },
                {
                  label: menuFor.archived ? 'Unarchive' : 'Archive',
                  onPress: () =>
                    run(() => actions.update(menuFor, { archived: !menuFor.archived })),
                },
                { label: 'Delete…', destructive: true, onPress: () => confirmDelete(menuFor) },
              ]
            : []
        }
        onClose={() => setMenuFor(null)}
      />
      <TextPrompt
        visible={renaming !== null}
        title="Rename chat"
        label="Title"
        initial={renaming?.title ?? ''}
        submitLabel="Save"
        maxLength={TITLE_MAX_CHARS}
        onSubmit={(title) => {
          if (renaming) {
            const c = renaming;
            run(() => actions.update(c, { title }));
          }
        }}
        onClose={() => setRenaming(null)}
      />
    </Screen>
  );
}
