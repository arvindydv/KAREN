import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme } from '../../theme/theme';
import { AssistantOrb } from './assistant-orb';

export interface Suggestion {
  label: string;
  /** The message sent when the card is tapped. */
  prompt: string;
  /** Icon-chip colour and glyph (a plain character; decorative). */
  tint: string;
  glyph: string;
}

/**
 * Starter prompts. Limited to what KAREN can really do in this build (answer, explain, draft,
 * plan in conversation) — nothing that implies memory, bookings or payments.
 */
export const SUGGESTIONS: readonly Suggestion[] = [
  {
    label: 'Plan my day',
    prompt: 'Help me plan my day. Ask me what I need to get done.',
    tint: '#3FBF7F',
    glyph: '☀',
  },
  {
    label: 'Draft a polite message',
    prompt: 'Help me write a polite message to reschedule a meeting.',
    tint: '#8E7CEB',
    glyph: '✎',
  },
  {
    label: 'Help me decide',
    prompt: 'Help me compare two options and decide. Ask me what they are.',
    tint: '#EE8A4E',
    glyph: '⚖',
  },
  {
    label: 'Hinglish mein baat karo',
    prompt: 'Chalo Hinglish mein baat karte hain! Aaj kya plan hai?',
    tint: '#3A6FE0',
    glyph: 'अ',
  },
];

/** "Good morning, Asha" — the greeting a person would use at this time of day (device clock). */
export function greeting(name: string | null, now: Date = new Date()): string {
  const hour = now.getHours();
  const part =
    hour < 5 ? 'Hey' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part === 'Hey' ? 'Hey there' : part;
}

/**
 * Centre of an empty chat: KAREN herself (the orb) and a personal greeting.
 * Scrolls rather than overlaps when space is short, and shrinks while the keyboard is open.
 */
export function ChatWelcome({
  name,
  compact = false,
  now,
}: {
  name: string | null;
  compact?: boolean;
  now?: Date;
}) {
  const t = useTheme();
  return (
    <ScrollView
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: t.spacing.xl,
        paddingVertical: t.spacing.md,
        gap: compact ? t.spacing.sm : t.spacing.md,
      }}
    >
      <AssistantOrb size={compact ? 72 : 136} />
      <Text
        accessibilityRole="header"
        style={{
          color: t.colors.textPrimary,
          fontSize: compact ? 19 : 24,
          lineHeight: compact ? 26 : 33,
          fontWeight: '500',
          textAlign: 'center',
        }}
      >
        <Text style={{ color: '#6CC4FF' }}>{`${greeting(name, now)}.`}</Text>
        {compact ? '' : ' What’s on your mind?'}
      </Text>
      {compact ? null : (
        <Text style={{ color: t.colors.textSecondary, fontSize: 14, textAlign: 'center' }}>
          Chat with me in English, हिंदी or Hinglish.
        </Text>
      )}
    </ScrollView>
  );
}

/** Horizontally scrolling starter cards shown above the composer on an empty chat. */
export function SuggestionCards({
  onPick,
  disabled,
}: {
  onPick: (s: Suggestion) => void;
  disabled: boolean;
}) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 10, paddingHorizontal: t.spacing.lg }}
      style={{ flexGrow: 0 }}
    >
      {SUGGESTIONS.map((s) => (
        <Pressable
          key={s.label}
          accessibilityRole="button"
          accessibilityLabel={`Suggestion: ${s.label}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onPick(s)}
          style={({ pressed }) => ({
            width: 132,
            minHeight: 112,
            padding: 14,
            borderRadius: 20,
            justifyContent: 'space-between',
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.10)',
            opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
          })}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: s.tint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}
            >
              {s.glyph}
            </Text>
          </View>
          <Text style={{ color: t.colors.textPrimary, fontSize: 14, lineHeight: 19 }}>
            {s.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
