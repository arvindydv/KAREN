import { Alert } from 'react-native';
import { MEMORY_COPY } from './copy';

/**
 * Delete-chat confirmation (M-05; default and copy are owner decision Q12 — draft). Says that
 * saved memories are KEPT unless the user explicitly picks the second option, which is ONE server
 * call (`delete_memories=true`). With the memory feature off it is the Phase 02 dialog.
 */
export function confirmDeleteChat(
  memoryFeature: boolean,
  onDelete: (deleteMemories: boolean) => void,
): void {
  if (!memoryFeature) {
    Alert.alert(
      'Delete this conversation?',
      'All its messages are permanently deleted. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDelete(false) },
      ],
    );
    return;
  }
  Alert.alert(MEMORY_COPY.deleteChatTitle, MEMORY_COPY.deleteChatBody, [
    { text: 'Cancel', style: 'cancel' },
    { text: MEMORY_COPY.deleteChatOnly, style: 'destructive', onPress: () => onDelete(false) },
    {
      text: MEMORY_COPY.deleteChatAndMemories,
      style: 'destructive',
      onPress: () => onDelete(true),
    },
  ]);
}

/**
 * Revoking "Remember things about me" (D6 delete-now option, default = keep paused). The second
 * call (clear all) needs no consent; if it fails, memories stay suspended (safe) and the user is
 * told where to delete them.
 */
export function confirmMemoryRevoke(onChoice: (deleteNow: boolean) => void): void {
  Alert.alert(MEMORY_COPY.revokeTitle, MEMORY_COPY.revokeBody, [
    { text: 'Cancel', style: 'cancel' },
    { text: MEMORY_COPY.revokeKeep, onPress: () => onChoice(false) },
    { text: MEMORY_COPY.revokeDelete, style: 'destructive', onPress: () => onChoice(true) },
  ]);
}
