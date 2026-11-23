import { useEffect, useMemo, useRef } from 'react';
import { Animated, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme/theme';
import { useReducedMotion } from './motion';

/**
 * "Brain universe": a slowly turning constellation of thought-nodes wired to a glowing core,
 * with sparks of light travelling along the connections and two orbit rings counter-rotating
 * around the core. Original artwork (no film/comic HUD), decorative only.
 *
 * Performance: everything is plain Views; ALL motion is transform/opacity on the native driver,
 * fed by just two looping clocks — so it runs on the UI thread and can't drop frames when JS is
 * busy. No blur filters. Static (still beautiful) when "reduce motion" is on.
 */

/** Deterministic PRNG so the constellation is identical on every launch. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Node {
  x: number;
  y: number;
  r: number;
  tint: 0 | 1 | 2;
}
interface Edge {
  x: number;
  y: number;
  len: number;
  angle: number;
}

function buildGraph(size: number, count: number, clear: number) {
  const rand = mulberry32(20261121);
  const c = size / 2;
  const R = size * 0.47;
  const nodes: Node[] = [];
  // Spread nodes evenly around the core (with jitter) so the constellation never clumps on
  // one side; distance is random between the clear zone and the outer edge.
  for (let i = 0; i < count; i++) {
    const d = clear + Math.sqrt(rand()) * Math.max(4, R - clear);
    const a = ((i + rand() * 0.7) / count) * Math.PI * 2;
    nodes.push({
      x: c + Math.cos(a) * d,
      y: c + Math.sin(a) * d * 0.92,
      r: 1.6 + rand() * 2.2,
      tint: rand() < 0.62 ? 0 : rand() < 0.75 ? 1 : 2,
    });
  }
  const edge = (ax: number, ay: number, bx: number, by: number): Edge => {
    const dx = bx - ax;
    const dy = by - ay;
    return {
      x: (ax + bx) / 2,
      y: (ay + by) / 2,
      len: Math.hypot(dx, dy),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  };
  const seen = new Set<string>();
  const edges: Edge[] = [];
  nodes.forEach((n, i) => {
    const nearest = nodes
      .map((m, j) => ({ j, d: Math.hypot(m.x - n.x, m.y - n.y) }))
      .filter((o) => o.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2);
    for (const { j } of nearest) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const m = nodes[j];
      if (m) edges.push(edge(n.x, n.y, m.x, m.y));
    }
  });
  // Spokes: the innermost thoughts connect to the core.
  const inner = [...nodes]
    .sort((p, q) => Math.hypot(p.x - c, p.y - c) - Math.hypot(q.x - c, q.y - c))
    .slice(0, Math.min(7, Math.ceil(count / 4)));
  for (const n of inner) edges.push(edge(c, c, n.x, n.y));
  const stars = Array.from({ length: Math.round(count * 1.5) }, () => ({
    x: rand(),
    y: rand(),
    s: rand() < 0.85 ? 1 : 2,
    o: 0.12 + rand() * 0.4,
  }));
  return { nodes, edges, stars };
}

const ring = (count: number, radius: number) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { x: Math.cos(a) * radius, y: Math.sin(a) * radius, big: i % 6 === 0 };
  });

export function NeuralCosmos({
  height,
  nodeCount = 30,
  core = 68,
}: {
  height: number;
  /** Thought-nodes in the constellation (fewer for the compact header version). */
  nodeCount?: number;
  /** Core diameter; the orbit rings scale with it. */
  core?: number;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const size = Math.min(width * 1.05, height);
  const innerR = core * 0.88;
  const outerR = core * 1.35;
  const { nodes, edges, stars } = useMemo(
    () => buildGraph(size, nodeCount, Math.max(size * 0.17, outerR + 8)),
    [nodeCount, outerR, size],
  );
  const innerRing = useMemo(() => ring(Math.round(innerR * 0.6), innerR), [innerR]);
  const outerRing = useMemo(() => ring(Math.round(outerR * 0.52), outerR), [outerR]);

  // Two clocks drive everything: a fast one (sparks, twinkle) and a slow one (rotation).
  const fast = useRef(new Animated.Value(0)).current;
  const slow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = (v: Animated.Value, duration: number) =>
      Animated.loop(
        Animated.timing(v, { toValue: 1, duration, easing: (x) => x, useNativeDriver: true }),
      );
    const a = loop(fast, 3200);
    const b = loop(slow, 120_000);
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [fast, reduced, slow]);

  const dark = t.scheme === 'dark';
  const tints = [t.colors.highlight, '#8E7CEB', '#7FD3EC'];
  const line = dark ? 'rgba(127,174,242,0.16)' : 'rgba(58,111,224,0.16)';
  const spin = (turns: number) =>
    slow.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${360 * turns}deg`] });
  const breathe = fast.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.06, 1] });

  /** Phase-shifted copy of the fast clock: p(t) = (t + phase) mod 1. */
  const phased = (phase: number): Animated.AnimatedInterpolation<number> =>
    phase === 0
      ? fast.interpolate({ inputRange: [0, 1], outputRange: [0, 1] })
      : fast.interpolate({
          inputRange: [0, 1 - phase, 1 - phase + 0.0001, 1],
          outputRange: [phase, 1, 0, phase],
        });

  const sparkEdges = edges.filter((_, i) => i % 3 === 0).slice(0, 14);
  const cx = width / 2;
  const cy = height / 2;
  const left = cx - size / 2;
  const top = cy - size / 2;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, overflow: 'hidden' }}
    >
      {/* Star dust (static). */}
      {stars.map((s, i) => (
        <View
          key={`s${i}`}
          style={{
            position: 'absolute',
            left: s.x * width,
            top: s.y * height,
            width: s.s,
            height: s.s,
            borderRadius: 1,
            backgroundColor: dark ? '#FFFFFF' : t.colors.accent,
            opacity: s.o,
          }}
        />
      ))}

      {/* Nebula glow behind the brain. Static gradient — no blur. */}
      <View
        style={{
          position: 'absolute',
          left: cx - size * 0.45,
          top: cy - size * 0.45,
          width: size * 0.9,
          height: size * 0.9,
          borderRadius: size,
          experimental_backgroundImage: dark
            ? 'radial-gradient(circle at 50% 50%, rgba(58,111,224,0.30) 0%, rgba(142,124,235,0.12) 40%, transparent 70%)'
            : 'radial-gradient(circle at 50% 50%, rgba(58,111,224,0.14) 0%, rgba(142,124,235,0.06) 40%, transparent 70%)',
        }}
      />

      {/* The turning constellation. */}
      <Animated.View
        style={{
          position: 'absolute',
          left,
          top,
          width: size,
          height: size,
          transform: [{ rotate: spin(1) }],
        }}
      >
        {edges.map((e, i) => (
          <View
            key={`e${i}`}
            style={{
              position: 'absolute',
              left: e.x - e.len / 2,
              top: e.y - 0.5,
              width: e.len,
              height: 1,
              backgroundColor: line,
              transform: [{ rotate: `${e.angle}deg` }],
            }}
          />
        ))}
        {sparkEdges.map((e, i) => {
          const p = phased((i * 0.137) % 1);
          return (
            <View
              key={`p${i}`}
              style={{
                position: 'absolute',
                left: e.x - e.len / 2,
                top: e.y - 1.5,
                width: e.len,
                height: 3,
                transform: [{ rotate: `${e.angle}deg` }],
              }}
            >
              <Animated.View
                style={{
                  width: 3,
                  height: 3,
                  borderRadius: 1.5,
                  backgroundColor: '#CFE2FF',
                  boxShadow: `0 0 6px 1px ${t.colors.highlight}`,
                  opacity: p.interpolate({
                    inputRange: [0, 0.15, 0.85, 1],
                    outputRange: [0, 1, 1, 0],
                  }),
                  transform: [
                    {
                      translateX: p.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, e.len - 3],
                      }),
                    },
                  ],
                }}
              />
            </View>
          );
        })}
        {nodes.map((n, i) => {
          const tint = tints[n.tint] ?? t.colors.highlight;
          return (
            <Animated.View
              key={`n${i}`}
              style={{
                position: 'absolute',
                left: n.x - n.r,
                top: n.y - n.r,
                width: n.r * 2,
                height: n.r * 2,
                borderRadius: n.r,
                backgroundColor: tint,
                boxShadow: `0 0 ${Math.round(n.r * 3)}px ${tint}`,
                opacity: phased((i * 0.29) % 1).interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0.45, 1, 0.45],
                }),
              }}
            />
          );
        })}
      </Animated.View>

      {/* Orbit rings, counter-rotating. */}
      {[
        { dots: innerRing, turns: 4, size: 2, color: t.colors.highlight, o: 0.55 },
        { dots: outerRing, turns: -2.5, size: 1.6, color: '#8E7CEB', o: 0.45 },
      ].map((r, k) => (
        <Animated.View
          key={`r${k}`}
          style={{
            position: 'absolute',
            left: cx,
            top: cy,
            width: 0,
            height: 0,
            transform: [{ rotate: spin(r.turns) }],
          }}
        >
          {r.dots.map((d, i) => (
            <View
              key={i}
              style={{
                position: 'absolute',
                left: d.x - (d.big ? r.size * 1.5 : r.size) / 2,
                top: d.y - (d.big ? r.size * 1.5 : r.size) / 2,
                width: d.big ? r.size * 1.5 : r.size,
                height: d.big ? r.size * 1.5 : r.size,
                borderRadius: r.size,
                backgroundColor: r.color,
                opacity: d.big ? 0.9 : r.o,
              }}
            />
          ))}
        </Animated.View>
      ))}

      {/* The core. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: cx - core / 2,
          top: cy - core / 2,
          width: core,
          height: core,
          borderRadius: core / 2,
          backgroundColor: t.colors.accent,
          experimental_backgroundImage:
            'radial-gradient(circle at 35% 30%, #EAF2FF 0%, #A9C8F5 14%, transparent 42%), radial-gradient(circle at 50% 55%, #5A8BEA 0%, #3A6FE0 45%, #1A3580 80%, #0E1E52 100%)',
          boxShadow: `0 0 ${Math.round(core * 0.4)}px ${Math.round(core * 0.09)}px rgba(90,139,234,0.45), 0 0 ${Math.round(core)}px ${Math.round(core * 0.24)}px rgba(58,111,224,0.22)`,
          transform: [{ scale: breathe }],
        }}
      />
    </View>
  );
}
