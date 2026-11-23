import { Pressable, Switch, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme';
import type { AssistantState } from './assistant';

const COPY: Record<AssistantState['phase'], { text: string; hint: string }> = {
  off: { text: '', hint: 'Starts listening' },
  wake: {
    text: 'Listening for “Hey KAREN” · on this phone',
    hint: 'Tap to talk without the wake word',
  },
  listening: { text: 'Listening…', hint: 'Tap to end the conversation' },
  thinking: { text: 'Thinking…', hint: 'Tap to stop' },
  speaking: { text: 'Speaking — just talk to interrupt', hint: 'Interrupts KAREN' },
};

/**
 * Voice status + the "Hey KAREN" switch (ADR-0030). Always shows when the microphone is in use
 * — the user can see at a glance whether KAREN is listening, and stop it.
 */
export function VoiceBar({
  state,
  handsFree,
  wakeAvailable,
  onTalk,
  onHandsFree,
}: {
  state: AssistantState;
  handsFree: boolean;
  wakeAvailable: boolean | null;
  onTalk: () => void;
  onHandsFree: (on: boolean) => void;
}) {
  const t = useTheme();
  const active = state.phase !== 'off';
  const listening = state.phase === 'listening' || state.phase === 'wake';
  const copy = COPY[state.phase];
  // While the user talks, show their words live — the clearest sign KAREN is hearing them.
  const text =
    state.phase === 'listening' && state.heard
      ? `“${state.heard}”`
      : state.phase === 'listening' && state.followUp
        ? 'Go ahead — I’m listening'
        : copy.text;
  const dot =
    state.phase === 'speaking'
      ? t.colors.accent
      : state.phase === 'listening'
        ? '#3FA2FF'
        : state.phase === 'wake'
          ? 'rgba(63,162,255,0.55)'
          : t.colors.textSecondary;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: t.minTouchTarget,
        paddingHorizontal: 12,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: active ? 'rgba(63,162,255,0.45)' : 'rgba(255,255,255,0.10)',
        backgroundColor: active ? 'rgba(47,123,240,0.14)' : 'rgba(255,255,255,0.05)',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={active ? text : 'Start a voice conversation'}
        accessibilityHint={copy.hint || undefined}
        accessibilityState={{ busy: state.phase === 'thinking' }}
        onPress={onTalk}
        style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
      >
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: dot,
            boxShadow: listening ? '0 0 10px 2px rgba(63,162,255,0.7)' : undefined,
          }}
        />
        <Text
          accessibilityLiveRegion="polite"
          numberOfLines={2}
          style={{ flex: 1, color: t.colors.textPrimary, fontSize: 14 }}
        >
          {active ? text : 'Say “Hey KAREN” — no tapping needed'}
        </Text>
      </Pressable>
      {wakeAvailable === false ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: t.colors.textSecondary, fontSize: 12 }}>Hey KAREN</Text>
          <Switch
            accessibilityLabel="Hands-free: listen for Hey KAREN"
            value={handsFree}
            onValueChange={onHandsFree}
            trackColor={{ true: '#2F7BF0', false: 'rgba(255,255,255,0.2)' }}
          />
        </View>
      )}
    </View>
  );
}
