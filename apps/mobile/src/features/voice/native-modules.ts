/* eslint-disable @typescript-eslint/no-require-imports -- deliberate lazy, guarded loading (see below) */
import { requireOptionalNativeModule } from 'expo';
import type * as AudioLib from 'expo-audio';
import type * as FileSystemLib from 'expo-file-system';
import type * as SpeechLib from 'expo-speech-recognition';

/**
 * The voice libraries contain native code. An app binary built BEFORE they were added (an older
 * development build, or Expo Go, which has no speech recogniser) does not contain it, and
 * importing them there crashes the whole app at start-up ("Cannot find native module …").
 *
 * So they are loaded only when their native module is present in THIS binary. Without them the
 * app works normally and voice explains what is missing (ADR-0030):
 * - no `ExpoAudio` / `FileSystem` → no talking at all (rebuild the development app);
 * - no `ExpoSpeechRecognition` → tap-to-talk works, "Hey KAREN" does not (e.g. Expo Go).
 */
const has = (name: string): boolean => Boolean(requireOptionalNativeModule(name));

export const audioLib: typeof AudioLib | null =
  has('ExpoAudio') && has('FileSystem') ? (require('expo-audio') as typeof AudioLib) : null;

export const fileSystemLib: typeof FileSystemLib | null = audioLib
  ? (require('expo-file-system') as typeof FileSystemLib)
  : null;

export const speechLib: typeof SpeechLib | null = has('ExpoSpeechRecognition')
  ? (require('expo-speech-recognition') as typeof SpeechLib)
  : null;

/** What this app binary can do with voice. */
export const voiceSupport = {
  /** Recording + playback: tap to talk and spoken answers. */
  talk: audioLib !== null,
  /** On-device recogniser present: "Hey KAREN" may be available (still checked at runtime). */
  wakeWord: audioLib !== null && speechLib !== null,
};
