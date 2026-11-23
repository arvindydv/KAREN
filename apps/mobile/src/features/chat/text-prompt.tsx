import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import {
  GlassCard,
  Heading,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from '../../components/primitives';
import { useTheme } from '../../theme/theme';

/** Cross-platform text prompt (Alert.prompt is iOS-only): rename, edit-and-resend. */
export function TextPrompt({
  visible,
  title,
  label,
  initial,
  submitLabel,
  maxLength,
  multiline = false,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  maxLength: number;
  multiline?: boolean;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (visible) setValue(initial);
  }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: t.spacing.xl,
          backgroundColor: 'rgba(0,0,0,0.5)',
        }}
      >
        <GlassCard style={{ gap: 12, backgroundColor: t.colors.surface }}>
          <Heading>{title}</Heading>
          <TextField
            label={label}
            value={value}
            onChangeText={setValue}
            maxLength={maxLength}
            multiline={multiline}
            autoFocus
          />
          <PrimaryButton
            label={submitLabel}
            disabled={value.trim().length === 0}
            onPress={() => {
              onClose();
              onSubmit(value.trim());
            }}
          />
          <SecondaryButton label="Cancel" onPress={onClose} />
        </GlassCard>
      </View>
    </Modal>
  );
}
