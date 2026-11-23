import { requireOptionalNativeModule } from 'expo';
import { useEffect, useRef } from 'react';
import { Animated, Text, View, useWindowDimensions } from 'react-native';
import { useReducedMotion, usePulse } from '../../components/motion';
import KarenOrbDom from './karen-orb.dom';

/**
 * OFF until `react-dom` + `react-native-web` are added to apps/mobile (JS-only packages the DOM
 * component bundle needs; awaiting approval to add dependencies). While off, the native
 * approximation below is shown so the screen never breaks.
 */
const WEB_ORB_ENABLED = true;

/** The DOM WebView ships with `expo`; absent only in unusual builds or tests. */
const hasDomWebView = (() => {
  if (!WEB_ORB_ENABLED) return false;
  try {
    return requireOptionalNativeModule('ExpoDomWebViewModule') !== null;
  } catch {
    // Not available in this runtime (e.g. Jest) — use the native drawing below.
    return false;
  }
})();

/**
 * KAREN's AI orb, identical to the web's: the web component itself (CSS gradients + animated
 * SVG turbulence) rendered in a transparent, non-interactive WebView. The glow spills well past
 * the sphere, so the WebView is larger than the space the orb takes in the layout and is
 * centred over it. Falls back to a native approximation when the WebView isn't available.
 */
export function AssistantOrb({ size = 136 }: { size?: number }) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const box = size * 1.44;
  if (!hasDomWebView) return <NativeOrb size={size} />;
  const canvas = Math.min(size * 2.6, width);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', width: canvas, height: canvas }}>
        <KarenOrbDom
          size={size}
          still={reduced}
          dom={{
            style: { width: canvas, height: canvas, backgroundColor: 'transparent' },
            containerStyle: { backgroundColor: 'transparent' },
            scrollEnabled: false,
            bounces: false,
            overScrollMode: 'never',
            showsHorizontalScrollIndicator: false,
            showsVerticalScrollIndicator: false,
          }}
        />
      </View>
    </View>
  );
}

/**
 * KAREN's AI orb — the native counterpart of the web `KarenOrb` (apps/web landing): a glowing
 * cyan plasma sphere (dark-navy heart, bright icy rim) with flowing rings and a white
 * mic with twinkling sparkles. React Native has no SVG turbulence/masks/blend modes, so the
 * "plasma" is approximated with off-centre ring layers that rotate in opposite directions —
 * the offsets make them wobble like the web's warped wisps. All motion is transform/opacity
 * on the native driver; static when the user has "reduce motion" on. Decorative.
 */
function NativeOrb({ size }: { size: number }) {
  const reduced = useReducedMotion();
  const breathe = usePulse();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 20_000,
        easing: (x: number) => x,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, spin]);

  const turn = (laps: number) =>
    spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${360 * laps}deg`] });
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const haloOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  const twinkle = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });
  const twinkle2 = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] });

  /** A full-size layer that spins, holding rings offset from the centre so they wobble. */
  const ringLayer = (
    rings: readonly { r: number; dx: number; dy: number; w: number; color: string }[],
    laps: number,
  ) => (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        transform: [{ rotate: turn(laps) }],
      }}
    >
      {rings.map((g, i) => {
        const d = size * g.r;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: (size - d) / 2 + size * g.dx,
              top: (size - d) / 2 + size * g.dy,
              width: d,
              height: d,
              borderRadius: d / 2,
              borderWidth: g.w,
              borderColor: g.color,
            }}
          />
        );
      })}
    </Animated.View>
  );

  const full = { position: 'absolute' as const, width: size, height: size, borderRadius: size };
  const outer = size * 1.44;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: outer, height: outer, alignItems: 'center', justifyContent: 'center' }}
    >
      {/* Halo */}
      <Animated.View
        style={{
          position: 'absolute',
          width: outer,
          height: outer,
          borderRadius: outer,
          opacity: haloOpacity,
          experimental_backgroundImage:
            'radial-gradient(circle closest-side, rgba(92,200,230,0.35) 0%, rgba(59,154,217,0.22) 55%, transparent 100%)',
        }}
      />
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          transform: [{ scale }],
          boxShadow:
            '0 0 18px 4px rgba(111,208,240,0.55), 0 0 46px 12px rgba(59,154,217,0.35), 0 0 90px 24px rgba(58,111,224,0.3)',
        }}
      >
        {/* Core: dark-navy heart to icy rim (same stops as the web orb). */}
        <View
          style={{
            ...full,
            experimental_backgroundImage:
              'radial-gradient(circle closest-side, #081436 0%, #14307a 30%, #2a5cc8 54%, #3b8be6 72%, #5ab8ee 85%, #9adff5 95%, #cdeefa 100%)',
          }}
        />
        {/* Dark plasma rings */}
        {ringLayer(
          [
            { r: 0.3, dx: 0.02, dy: -0.01, w: size * 0.035, color: 'rgba(10,26,78,0.45)' },
            { r: 0.5, dx: -0.025, dy: 0.02, w: size * 0.04, color: 'rgba(10,26,78,0.4)' },
            { r: 0.7, dx: 0.03, dy: 0.025, w: size * 0.035, color: 'rgba(10,26,78,0.32)' },
          ],
          1,
        )}
        {/* Light plasma wisps (counter-rotating) */}
        {ringLayer(
          [
            { r: 0.4, dx: -0.03, dy: 0.02, w: 1.5, color: 'rgba(172,226,246,0.45)' },
            { r: 0.6, dx: 0.035, dy: -0.02, w: 2, color: 'rgba(172,226,246,0.38)' },
            { r: 0.8, dx: -0.02, dy: -0.03, w: 1.5, color: 'rgba(190,235,250,0.32)' },
          ],
          -1.4,
        )}
        {/* Glint sweeping round the rim */}
        <Animated.View
          style={{
            ...full,
            borderWidth: size * 0.06,
            borderColor: 'transparent',
            borderTopColor: 'rgba(140,216,242,0.35)',
            borderLeftColor: 'rgba(100,180,236,0.18)',
            transform: [{ rotate: turn(2.6) }],
          }}
        />
        {/* Icy rim + top-left shine */}
        <View
          style={{
            ...full,
            experimental_backgroundImage:
              'radial-gradient(circle closest-side, transparent 76%, rgba(95,190,238,0.3) 87%, rgba(128,210,240,0.75) 95%, rgba(180,232,248,0.85) 100%)',
          }}
        />
        <View
          style={{
            ...full,
            experimental_backgroundImage:
              'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.05) 18%, transparent 34%)',
          }}
        />
      </Animated.View>
      <OrbMic size={size * 0.34} twinkle={twinkle} twinkle2={twinkle2} />
    </View>
  );
}

/** White mic with a small "eye" dot and two twinkling sparkles (as on the web orb). */
function OrbMic({
  size,
  twinkle,
  twinkle2,
}: {
  size: number;
  twinkle: Animated.AnimatedInterpolation<number>;
  twinkle2: Animated.AnimatedInterpolation<number>;
}) {
  const u = size / 24; // the web glyph's 24-unit viewBox
  return (
    <View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        boxShadow: '0 0 10px 0 rgba(196,226,248,0.5)',
        borderRadius: size,
      }}
    >
      {/* capsule */}
      <View
        style={{
          position: 'absolute',
          left: 8 * u,
          top: 3.5 * u,
          width: 8 * u,
          height: 11.5 * u,
          borderRadius: 4 * u,
          backgroundColor: '#fff',
        }}
      />
      {/* eye dot */}
      <View
        style={{
          position: 'absolute',
          left: (13.6 - 1.15) * u,
          top: (7.6 - 1.15) * u,
          width: 2.3 * u,
          height: 2.3 * u,
          borderRadius: 2.3 * u,
          backgroundColor: '#22397a',
        }}
      />
      {/* holder arc */}
      <View
        style={{
          position: 'absolute',
          left: 5.8 * u,
          top: 5.1 * u,
          width: 12.4 * u,
          height: 12.4 * u,
          borderRadius: 6.2 * u,
          borderWidth: 1.8 * u,
          // Top edge transparent so only the lower "U" of the ring shows.
          borderColor: '#fff',
          borderTopColor: 'transparent',
        }}
      />
      {/* stem + base */}
      <View
        style={{
          position: 'absolute',
          left: 11.1 * u,
          top: 17.6 * u,
          width: 1.8 * u,
          height: 2.8 * u,
          backgroundColor: '#fff',
          borderRadius: u,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: 9.2 * u,
          top: 19.5 * u,
          width: 5.6 * u,
          height: 1.8 * u,
          backgroundColor: '#fff',
          borderRadius: u,
        }}
      />
      {/* sparkles */}
      <Animated.Text
        style={{
          position: 'absolute',
          left: 17.4 * u,
          top: -0.6 * u,
          color: '#fff',
          fontSize: 6.5 * u,
          lineHeight: 7 * u,
          opacity: twinkle,
        }}
      >
        ✦
      </Animated.Text>
      <Text
        style={{
          position: 'absolute',
          left: 20.4 * u,
          top: 5.2 * u,
          color: '#fff',
          fontSize: 3.6 * u,
          lineHeight: 4 * u,
        }}
      >
        <Animated.Text style={{ opacity: twinkle2 }}>✦</Animated.Text>
      </Text>
    </View>
  );
}

/** Deterministic faint starfield for the chat screen background. Static, decorative. */
export function StarField() {
  const stars = useRef(makeStars(70)).current;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
    >
      {stars.map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.r,
            height: s.r,
            borderRadius: s.r,
            backgroundColor: '#FFFFFF',
            opacity: s.o,
          }}
        />
      ))}
    </View>
  );
}

function makeStars(n: number) {
  let a = 20261122;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => ({
    x: rand() * 100,
    y: rand() * 100,
    r: rand() < 0.85 ? 1.5 : 2.5,
    o: 0.15 + rand() * 0.55,
  }));
}
