/** Jest stand-in for expo-audio (native). Voice logic is tested through injected fakes. */
const recorder = {
  prepareToRecordAsync: async () => undefined,
  record: () => undefined,
  stop: async () => undefined,
  getStatus: () => ({
    metering: undefined,
    durationMillis: 0,
    isRecording: false,
    canRecord: true,
  }),
  uri: null,
};
export const RecordingPresets = {
  HIGH_QUALITY: { extension: '.m4a' },
  LOW_QUALITY: { extension: '.m4a' },
};
export const useAudioRecorder = () => recorder;
export const useAudioStream = () => ({
  stream: { start: async () => undefined, stop: () => undefined, isStreaming: false },
  isStreaming: false,
});
export const requestRecordingPermissionsAsync = async () => ({ granted: true, status: 'granted' });
export const setAudioModeAsync = async () => undefined;
export const createAudioPlayer = () => ({
  play: () => undefined,
  pause: () => undefined,
  remove: () => undefined,
  addListener: () => ({ remove: () => undefined }),
});
