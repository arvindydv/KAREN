import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import {
  Badge,
  Body,
  PrimaryButton,
  Screen,
  SecondaryButton,
} from '../../src/components/primitives';
import { mobileEnv } from '../../src/lib/env';
import { useTheme } from '../../src/theme/theme';

/** Decorative light ribbons (blue→violet and lime→green), blurred bands like the web hero. */
function Ribbons() {
  const t = useTheme();
  const [coolFrom, coolTo] = t.brand.ribbonCool;
  const [warmFrom, warmTo] = t.brand.ribbonWarm;
  const band = (style: object, gradient: string) => (
    <View
      style={[
        {
          position: 'absolute',
          borderRadius: 400,
          experimental_backgroundImage: gradient,
          filter: 'blur(14px)',
        },
        style,
      ]}
    />
  );
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '62%', overflow: 'hidden' }}
    >
      {band(
        { width: 620, height: 260, top: 40, left: -260, transform: [{ rotate: '-38deg' }] },
        `linear-gradient(90deg, transparent, ${coolFrom} 40%, ${coolTo})`,
      )}
      {band(
        { width: 520, height: 120, top: 10, right: -200, transform: [{ rotate: '52deg' }] },
        `linear-gradient(90deg, transparent, ${warmTo} 35%, ${warmFrom})`,
      )}
      {band(
        { width: 560, height: 200, top: 260, right: -320, transform: [{ rotate: '-30deg' }] },
        `linear-gradient(90deg, ${coolTo}, ${coolFrom} 60%, transparent)`,
      )}
    </View>
  );
}

/** Launch / welcome screen: entry to sign-up and sign-in. */
export default function WelcomeScreen() {
  const t = useTheme();
  const router = useRouter();
  return (
    <Screen padded={false}>
      <Ribbons />
      <View style={{ flex: 1, paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.xl }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: t.spacing.lg }}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              experimental_backgroundImage:
                'linear-gradient(135deg, #60A5FA, #2563EB 60%, #1D4ED8)',
              backgroundColor: t.colors.accent,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>K</Text>
          </View>
          <Text style={{ color: t.colors.textPrimary, fontSize: 20, fontWeight: '600' }}>
            KAREN
          </Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'flex-end', gap: t.spacing.lg }}>
          <Badge label="Personal AI life agent" />
          <Text
            accessibilityRole="header"
            style={{
              color: t.colors.textPrimary,
              fontSize: 40,
              lineHeight: 46,
              fontWeight: '600',
              letterSpacing: -1,
            }}
          >
            <Text style={{ color: t.colors.highlight }}>Your life.</Text>
            {'\n'}Understood.{'\n'}Taken care of.
          </Text>
          <Body muted>
            Tell KAREN what matters. It remembers, prepares, acts with your permission and follows
            through.
          </Body>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ flexDirection: 'row', gap: 6, marginTop: t.spacing.xs }}
          >
            <View
              style={{
                width: 22,
                height: 4,
                borderRadius: 2,
                backgroundColor: t.colors.textPrimary,
              }}
            />
            <View
              style={{ width: 8, height: 4, borderRadius: 2, backgroundColor: t.colors.border }}
            />
            <View
              style={{ width: 8, height: 4, borderRadius: 2, backgroundColor: t.colors.border }}
            />
          </View>
        </View>

        <View style={{ gap: t.spacing.md, marginTop: t.spacing.xxl }}>
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
          <Text style={{ color: t.colors.textSecondary, fontSize: 12, textAlign: 'center' }}>
            Pre-release build · {mobileEnv.EXPO_PUBLIC_APP_ENV}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
