import { View } from 'react-native';

/**
 * Tiny icons drawn with plain Views (the app has no icon/SVG dependency). All decorative:
 * the surrounding button carries the accessibility label.
 */
const hidden = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

/** Microphone: rounded capsule, U-shaped holder and a short stand. */
export function MicGlyph({ color, size = 20 }: { color: string; size?: number }) {
  const s = size / 20;
  return (
    <View {...hidden} style={{ width: 14 * s, height: 20 * s, alignItems: 'center' }}>
      <View
        style={{
          width: 7 * s,
          height: 11 * s,
          borderRadius: 4 * s,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 5 * s,
          width: 13 * s,
          height: 10 * s,
          borderWidth: 1.8 * s,
          borderTopWidth: 0,
          borderColor: color,
          borderBottomLeftRadius: 7 * s,
          borderBottomRightRadius: 7 * s,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 15 * s,
          width: 1.8 * s,
          height: 4 * s,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** Upward send arrow. */
export function SendGlyph({ color, size = 18 }: { color: string; size?: number }) {
  const s = size / 18;
  return (
    <View {...hidden} style={{ width: 14 * s, height: 16 * s, alignItems: 'center' }}>
      <View
        style={{
          marginTop: 2 * s,
          width: 9 * s,
          height: 9 * s,
          borderTopWidth: 2 * s,
          borderLeftWidth: 2 * s,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 2 * s,
          width: 2 * s,
          height: 13 * s,
          borderRadius: 1 * s,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** Rounded stop square. */
export function StopGlyph({ color }: { color: string }) {
  return (
    <View {...hidden} style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color }} />
  );
}

/** Vertical "more" dots. */
export function MoreGlyph({ color }: { color: string }) {
  return (
    <View {...hidden} style={{ gap: 3, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
      ))}
    </View>
  );
}
