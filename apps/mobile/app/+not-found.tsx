import { Link } from 'expo-router';
import { Body, Heading, Screen } from '../src/components/primitives';

export default function NotFound() {
  return (
    <Screen>
      <Heading>Not found</Heading>
      <Link href="/">
        <Body>Go to start</Body>
      </Link>
    </Screen>
  );
}
