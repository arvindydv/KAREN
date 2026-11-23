module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo-export-check/'],
  // Expo DOM components need a WebView; Jest renders a stub instead.
  moduleNameMapper: {
    '^\\.{1,2}/.*\\.dom$': '<rootDir>/src/test/dom-component-stub.tsx',
    // Native voice modules (ADR-0030): stubs; the voice logic is tested with injected fakes.
    '^expo-audio$': '<rootDir>/src/test/expo-audio-stub.ts',
    '^expo-speech-recognition$': '<rootDir>/src/test/expo-speech-recognition-stub.ts',
    '^expo-file-system$': '<rootDir>/src/test/expo-file-system-stub.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-router|expo-modules-core|@karen/.*|zustand|@tanstack/.*))',
  ],
};
