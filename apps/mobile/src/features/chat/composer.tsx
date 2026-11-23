import { MESSAGE_MAX_CHARS } from '@karen/api-contracts';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../theme/theme';
import { SendGlyph, StopGlyph } from './glyphs';

/**
 * Pill-shaped message input with a glowing blue action capsule (send, or stop while
 * KAREN is answering). Enforces the 8 000-character limit client-side too.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  generating,
  disabled,
  disabledReason,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  generating: boolean;
  disabled: boolean;
  disabledReason?: string;
}) {
  const t = useTheme();
  const remaining = MESSAGE_MAX_CHARS - value.length;
  const canSend = !disabled && !generating && value.trim().length > 0 && remaining >= 0;
  const round = {
    width: t.minTouchTarget,
    height: t.minTouchTarget,
    borderRadius: t.minTouchTarget / 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  return (
    <View style={{ gap: 4 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          gap: 6,
          backgroundColor: 'rgba(255,255,255,0.07)',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          borderRadius: 30,
          padding: 5,
          paddingLeft: 14,
        }}
      >
        <TextInput
          accessibilityLabel="Message KAREN"
          accessibilityHint={disabled ? disabledReason : undefined}
          placeholder="Message KAREN"
          placeholderTextColor={t.colors.textSecondary}
          value={value}
          onChangeText={onChange}
          multiline
          maxLength={MESSAGE_MAX_CHARS}
          editable={!disabled}
          style={{
            flex: 1,
            minHeight: t.minTouchTarget,
            maxHeight: 140,
            color: t.colors.textPrimary,
            fontSize: 16,
            paddingVertical: 11,
          }}
        />
        <View
          style={{
            flexDirection: 'row',
            borderRadius: 27,
            padding: 2,
            boxShadow: '0 0 18px 0 rgba(58,140,255,0.45)',
            experimental_backgroundImage: 'linear-gradient(90deg, #2F7BF0 0%, #3FA2FF 100%)',
          }}
        >
          {generating ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop answer"
              onPress={onStop}
              style={round}
            >
              <StopGlyph color="#fff" />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={onSend}
              style={({ pressed }) => ({
                ...round,
                backgroundColor: canSend ? 'rgba(255,255,255,0.22)' : 'transparent',
                opacity: canSend ? (pressed ? 0.7 : 1) : 0.5,
              })}
            >
              <SendGlyph color="#fff" />
            </Pressable>
          )}
        </View>
      </View>
      {remaining < 500 ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: remaining < 0 ? t.colors.danger : t.colors.textSecondary, fontSize: 12 }}
        >
          {remaining} characters left
        </Text>
      ) : null}
    </View>
  );
}
