import { useEffect, useRef } from 'react';
import { Animated, Pressable, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SpaceBackground } from '../../components/primitives';
import { useReducedMotion } from '../../components/motion';
import { useTheme } from '../../theme/theme';
import { AssistantOrb, StarField } from '../chat/assistant-orb';
import { SuggestionCards, greeting, type Suggestion } from '../chat/chat-welcome';
import type { AssistantState } from './assistant';

/**
 * Voice mode (ADR-0032): while you talk to KAREN the screen stays a calm, immersive orb — no
 * transcript, no chat bubbles. The orb itself shows the state: breathing while listening,
 * slowly swirling while thinking, pulsing while KAREN speaks. The conversation is still saved to
 * the chat (visible when you leave voice mode).
 */
export function VoiceMode({
  state,
  name,
  notice,
  handsFree,
  wakeAvailable,
  onOrb,
  onClose,
  onSuggestion,
  onHandsFree,
}: {
  state: AssistantState;
  name: string | null;
  notice: string | null;
  handsFree: boolean;
  wakeAvailable: boolean | null;
  /** Tap the orb: talk / interrupt KAREN / end the turn. */
  onOrb: () => void;
  onClose: () => void;
  onSuggestion: (s: Suggestion) => void;
  onHandsFree: (on: boolean) => void;
}) {
  const t = useTheme();
  const phase = state.phase;
  const status =
    phase === 'listening'
      ? state.followUp
        ? 'I’m listening…'
        : 'Go ahead, I’m listening'
      : phase === 'thinking'
        ? 'Hmm…'
        : phase === 'speaking'
          ? 'Tap me to interrupt'
          : phase === 'wake'
            ? 'Say “Hey KAREN” or tap the orb'
            : 'Tap the orb to talk';
  return (
    <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20 }}>
      <View style={{ flex: 1, backgroundColor: t.colors.background }}>
        <SpaceBackground />
        <StarField />
        <SafeAreaView style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: t.spacing.lg,
              paddingTop: t.spacing.sm,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Leave voice mode"
              onPress={onClose}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.08)',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: t.colors.textPrimary, fontSize: 20 }}>✕</Text>
            </Pressable>
            <Text style={{ color: t.colors.textPrimary, fontSize: 16, fontWeight: '500' }}>
              KAREN
            </Text>
            {wakeAvailable === false ? (
              <View style={{ width: 44 }} />
            ) : (
              <Switch
                accessibilityLabel="Hands-free: listen for Hey KAREN"
                value={handsFree}
                onValueChange={onHandsFree}
                trackColor={{ true: '#2F7BF0', false: 'rgba(255,255,255,0.2)' }}
              />
            )}
          </View>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 28 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                phase === 'speaking' || phase === 'thinking'
                  ? 'Interrupt KAREN'
                  : phase === 'listening'
                    ? 'End the conversation'
                    : 'Talk to KAREN'
              }
              accessibilityHint={status}
              onPress={onOrb}
            >
              <LivingOrb phase={phase} />
            </Pressable>
            <View style={{ paddingHorizontal: t.spacing.xl, gap: 10 }}>
              <Text
                accessibilityRole="header"
                style={{
                  color: t.colors.textPrimary,
                  fontSize: 26,
                  lineHeight: 34,
                  fontWeight: '500',
                  textAlign: 'center',
                }}
              >
                <Text style={{ color: '#6CC4FF' }}>{`${greeting(name)}.`}</Text> What’s on your
                mind?
              </Text>
              <Text
                accessibilityLiveRegion="polite"
                style={{ color: t.colors.textSecondary, fontSize: 15, textAlign: 'center' }}
              >
                {status}
              </Text>
              {notice ? (
                <Text style={{ color: '#FFB86B', fontSize: 13, textAlign: 'center' }}>
                  {notice}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={{ paddingBottom: t.spacing.lg }}>
            <SuggestionCards disabled={phase === 'thinking'} onPick={(s) => onSuggestion(s)} />
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}

const smooth = (x: number) => 0.5 - Math.cos(Math.PI * x) / 2;
const linear = (x: number) => x;

/** The orb, animated by what KAREN is doing (transform/opacity only, native driver). */
function LivingOrb({ phase }: { phase: AssistantState['phase'] }) {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const duration = phase === 'speaking' ? 420 : phase === 'listening' ? 1_400 : 2_400;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration,
          easing: smooth,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration,
          easing: smooth,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse, reduced]);

  useEffect(() => {
    if (reduced || phase !== 'thinking') {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2_600,
        easing: linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, reduced, spin]);

  const amplitude = phase === 'speaking' ? 0.1 : phase === 'listening' ? 0.06 : 0.025;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + amplitude] });
  const glow = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: phase === 'speaking' ? [0.55, 1] : [0.35, 0.7],
  });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const dim = phase === 'off' || phase === 'wake' ? 0.85 : 1;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: 250,
          height: 250,
          borderRadius: 125,
          backgroundColor: 'rgba(63,162,255,0.18)',
          opacity: glow,
          transform: [{ scale }],
        }}
      />
      <Animated.View style={{ opacity: dim, transform: [{ scale }, { rotate }] }}>
        <AssistantOrb size={180} />
      </Animated.View>
    </View>
  );
}
