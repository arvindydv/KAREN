/** Jest stand-in for expo-speech-recognition (native): no recogniser available. */
export const ExpoSpeechRecognitionModule = {
  isRecognitionAvailable: () => false,
  supportsOnDeviceRecognition: () => false,
  requestPermissionsAsync: async () => ({ granted: false }),
  getSupportedLocales: async () => ({ locales: [], installedLocales: [] }),
  addListener: () => ({ remove: () => undefined }),
  start: () => undefined,
  stop: () => undefined,
  abort: () => undefined,
};
