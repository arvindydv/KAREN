import { Modal, Pressable, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme';

export interface SheetOption {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

/** Cross-platform, accessible bottom action sheet (Android Alert allows only 3 buttons). */
export function ActionSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title?: string;
  options: SheetOption[];
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close menu"
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
      >
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: t.colors.surface,
            borderTopLeftRadius: t.radius.lg,
            borderTopRightRadius: t.radius.lg,
            padding: t.spacing.lg,
            gap: 4,
          }}
        >
          {title ? (
            <Text
              accessibilityRole="header"
              style={{ color: t.colors.textSecondary, fontSize: 13, marginBottom: 4 }}
            >
              {title}
            </Text>
          ) : null}
          {[...options, { label: 'Cancel', onPress: () => undefined }].map((o) => (
            <Pressable
              key={o.label}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              onPress={() => {
                onClose();
                o.onPress();
              }}
              style={({ pressed }) => ({
                minHeight: Math.max(48, t.minTouchTarget),
                justifyContent: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text
                style={{
                  color:
                    'destructive' in o && o.destructive ? t.colors.danger : t.colors.textPrimary,
                  fontSize: 16,
                  fontWeight: o.label === 'Cancel' ? '600' : '400',
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}
