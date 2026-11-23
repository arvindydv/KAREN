import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { Chevron } from '../../components/primitives';
import { useTheme, type NativeTheme } from '../../theme/theme';
import { MoreGlyph } from './glyphs';

/** True while the on-screen keyboard is shown. */
export function useKeyboardVisible(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}

export const circleButton = (t: NativeTheme) => ({
  width: t.minTouchTarget,
  height: t.minTouchTarget,
  borderRadius: t.minTouchTarget / 2,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: 'rgba(255,255,255,0.07)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.12)',
});

/** Chat top bar: round back button, centred title, round "more" button. */
export function ChatHeader({
  title,
  backLabel,
  onBack,
  menuLabel,
  onMenu,
  left,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  menuLabel: string;
  onMenu: () => void;
  /** Replaces the back chevron (e.g. a list icon on the start screen). */
  left?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        onPress={onBack}
        style={({ pressed }) => [circleButton(t), { opacity: pressed ? 0.7 : 1 }]}
      >
        {left ?? <Chevron color={t.colors.textPrimary} direction="left" />}
      </Pressable>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={{
          flex: 1,
          textAlign: 'center',
          color: t.colors.textPrimary,
          fontSize: 17,
          fontWeight: '600',
        }}
      >
        {title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={menuLabel}
        onPress={onMenu}
        style={({ pressed }) => [circleButton(t), { opacity: pressed ? 0.7 : 1 }]}
      >
        <MoreGlyph color={t.colors.textPrimary} />
      </Pressable>
    </View>
  );
}

/** Three short lines: "all chats" list icon. Decorative. */
export function ListGlyph({ color }: { color: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ gap: 4 }}
    >
      {[16, 12, 16].map((w, i) => (
        <View key={i} style={{ width: w, height: 2, borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}
