import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { useServices } from '../../src/auth/services';
import {
  Caption,
  CardTitle,
  DangerLink,
  ErrorState,
  FormScreen,
  GlassCard,
  Heading,
  LinkRow,
  ListCard,
  PrimaryButton,
} from '../../src/components/primitives';
import { QueryView } from '../../src/components/query-view';
import { describeError, unwrap } from '../../src/lib/api-error';
import { qk, useOnboarding, useProfile } from '../../src/lib/queries';
import { useSubmit } from '../../src/lib/use-submit';
import { useQueryClient } from '@tanstack/react-query';

export default function HomeScreen() {
  const router = useRouter();
  const { api, session } = useServices();
  const client = useQueryClient();
  const profile = useProfile();
  const onboarding = useOnboarding();

  const resume = useSubmit(
    useCallback(async () => {
      if (onboarding.data?.status === 'skipped') {
        const next = await unwrap(api.POST('/v1/me/onboarding/resume'));
        client.setQueryData(qk.onboarding, next);
      }
      router.push('/onboarding');
    }, [api, client, onboarding.data?.status, router]),
  );
  const signOut = useSubmit(useCallback(() => session.logout(), [session]));

  const name = profile.data?.preferred_name ?? profile.data?.display_name;
  return (
    <FormScreen>
      <Heading>{name ? `Hello, ${name}` : 'Welcome to KAREN'}</Heading>
      {profile.isError ? (
        <ErrorState message={describeError(profile.error)} onRetry={() => void profile.refetch()} />
      ) : null}

      <QueryView query={onboarding} loadingLabel="Loading setup progress">
        {(o) =>
          o.status === 'completed' ? null : (
            <GlassCard style={{ gap: 12 }}>
              <CardTitle>
                {o.status === 'not_started' ? 'Set up KAREN' : 'Finish setting up KAREN'}
              </CardTitle>
              <Caption>
                Language, how KAREN addresses you, accessibility and privacy choices. Optional — you
                can use the app without it, and skip at any point.
              </Caption>
              {resume.error ? <ErrorState message={describeError(resume.error)} /> : null}
              <PrimaryButton
                label={o.status === 'not_started' ? 'Start setup' : 'Continue setup'}
                disabled={resume.busy}
                onPress={() => resume.run()}
              />
            </GlassCard>
          )
        }
      </QueryView>

      <GlassCard style={{ gap: 12 }}>
        <CardTitle>Chat with KAREN</CardTitle>
        <Caption>
          Ask questions in English, हिंदी or Hinglish. Needs your permission for AI processing.
        </Caption>
        <PrimaryButton label="Open chats" onPress={() => router.push('/chat')} />
      </GlassCard>

      <GlassCard style={{ gap: 8 }}>
        <CardTitle>What works in this build</CardTitle>
        <Caption>
          Chat with KAREN, your account and sign-in security, profile and preferences, privacy and
          consent choices, and requests to export or delete your data.
        </Caption>
        <Caption>
          Not available yet: memory of other chats, reminders, and acting on tasks. When those
          arrive, KAREN will always ask before it sends, buys, books or shares anything.
        </Caption>
      </GlassCard>

      <ListCard>
        <LinkRow
          label="Settings"
          description="Profile, preferences, security and privacy"
          onPress={() => router.push('/settings')}
        />
      </ListCard>
      <View style={{ alignItems: 'center' }}>
        <DangerLink
          label={signOut.busy ? 'Signing out…' : 'Sign out'}
          disabled={signOut.busy}
          onPress={() => signOut.run()}
        />
      </View>
    </FormScreen>
  );
}
