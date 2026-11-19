// Emits dist/tokens.css from the compiled token module so CSS never drifts from tokens.ts.
import { writeFileSync } from 'node:fs';
import { tokensToCss } from '../dist/tokens.js';

writeFileSync(new URL('../dist/tokens.css', import.meta.url), tokensToCss());
