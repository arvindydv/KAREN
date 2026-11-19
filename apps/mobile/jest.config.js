module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo-export-check/'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-router|expo-modules-core|@karen/.*|zustand|@tanstack/.*))',
  ],
};
