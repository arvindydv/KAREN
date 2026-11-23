import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Animated, Text, View, useWindowDimensions } from 'react-native';
import {
  Body,
  Monogram,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '../../src/components/primitives';
import { Reveal, usePulse } from '../../src/components/motion';
import { NeuralCosmos } from '../../src/components/neural-cosmos';
import { mobileEnv } from '../../src/lib/env';
import { useTheme } from '../../src/theme/theme';

/** Launch / welcome screen: entry to sign-up and sign-in. Quiet, typographic, no decoration. */
export default function WelcomeScreen() {
  const t = useTheme();
  const router = useRouter();
  const pulse = usePulse();
  const { width } = useWindowDimensions();
  const [cosmosHeight, setCosmosHeight] = useState(0);
  // Scale the headline on narrow phones so "Understood." never wraps or clips.
  const headline = Math.max(32, Math.min(44, Math.round(width * 0.11)));
  return (
    <Screen padded={false}>
      <View style={{ flex: 1, paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.xl }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: t.spacing.lg }}
        >
          <Monogram size={36} />
          <Text
            style={{
              color: t.colors.textPrimary,
              fontSize: 17,
              fontWeight: '600',
              letterSpacing: 3,
            }}
          >
            KAREN
          </Text>
        </View>

        {/* The brain fills whatever space sits above the text, so they never overlap. */}
        <View
          style={{ flex: 1, minHeight: 120, marginHorizontal: -t.spacing.xl }}
          onLayout={(e) => setCosmosHeight(Math.round(e.nativeEvent.layout.height))}
        >
          {cosmosHeight > 0 ? <NeuralCosmos height={cosmosHeight} /> : null}
        </View>
        <View style={{ gap: t.spacing.lg }}>
          <Reveal index={0}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {/* KAREN's ember core: a slow "alive" pulse. Decorative. */}
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}
              >
                <Animated.View
                  style={{
                    position: 'absolute',
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: t.colors.accent,
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.4] }),
                    transform: [
                      {
                        scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.35] }),
                      },
                    ],
                  }}
                />
                <View
                  style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.accent }}
                />
              </View>
              <Text
                style={{
                  color: t.colors.textSecondary,
                  fontSize: 12,
                  fontWeight: '600',
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                }}
              >
                Personal AI life agent
              </Text>
            </View>
          </Reveal>
          <Reveal index={1}>
            <Text
              accessibilityRole="header"
              style={{
                color: t.colors.textPrimary,
                fontSize: headline,
                lineHeight: Math.round(headline * 1.1),
                fontWeight: '700',
                letterSpacing: -1.6,
              }}
            >
              Your life.{'\n'}Understood.{'\n'}
              <Text style={{ color: t.colors.highlight }}>Taken care of.</Text>
            </Text>
          </Reveal>
          <Reveal index={2}>
            <Body muted>
              Tell KAREN what matters. It remembers, prepares, acts with your permission and follows
              through.
            </Body>
          </Reveal>
        </View>

        <Reveal index={3} style={{ gap: t.spacing.md, marginTop: t.spacing.xxl }}>
          <PrimaryButton
            label="Create account"
            hint="Sign up with your e-mail address"
            onPress={() => router.push('/sign-up')}
          />
          <SecondaryButton
            label="Sign in"
            hint="Sign in to an existing account"
            onPress={() => router.push('/sign-in')}
          />
          <Text
            style={{
              color: t.colors.textSecondary,
              fontSize: 11,
              textAlign: 'center',
              marginTop: t.spacing.xs,
            }}
          >
            Pre-release build · {mobileEnv.EXPO_PUBLIC_APP_ENV}
          </Text>
        </Reveal>
      </View>
    </Screen>
  );
}
