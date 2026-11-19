import globals from 'globals';
import { createBaseConfig } from './base.js';

export function createNodeConfig(options = {}) {
  return [...createBaseConfig(options), { languageOptions: { globals: { ...globals.node } } }];
}
