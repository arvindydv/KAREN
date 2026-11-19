// Expo's default Metro config supports pnpm workspaces (symlinks + monorepo root watch).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
