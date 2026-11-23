module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo-export-check/'],
  // Expo DOM components need a WebView; Jest renders a stub instead.
  moduleNameMapper: {
    '^\\.{1,2}/.*\\.dom$': '<rootDir>/src/test/dom-component-stub.tsx',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-router|expo-modules-core|@karen/.*|zustand|@tanstack/.*))',
  ],
};
