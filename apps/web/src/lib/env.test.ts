import { describe, expect, it } from 'vitest';
import { publicEnv } from './env';

describe('public env', () => {
  it('defaults to local API without any secrets', () => {
    expect(publicEnv.NEXT_PUBLIC_API_BASE_URL).toBe('http://localhost:4100');
    expect(Object.keys(publicEnv).every((k) => k.startsWith('NEXT_PUBLIC_'))).toBe(true);
  });
});
