import type { PreferencesPatch, ProfilePatch } from '@karen/api-contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApi } from '../auth/services';
import { ApiRequestError, unwrap } from './api-error';
import { ifMatch, qk } from './queries';

/**
 * Optimistic-concurrency PATCH helpers. They send `If-Match` with the version last read; on
 * 412 PRECONDITION_FAILED they reload the resource and rethrow so the screen can tell the user.
 */
export function usePatchProfile() {
  const api = useApi();
  const client = useQueryClient();
  return useCallback(
    async (patch: ProfilePatch) => {
      const current = await client.ensureQueryData({
        queryKey: qk.profile,
        queryFn: () => unwrap(api.GET('/v1/me/profile')),
      });
      try {
        const next = await unwrap(
          api.PATCH('/v1/me/profile', {
            params: { header: { 'If-Match': ifMatch(current.version) } },
            body: patch,
          }),
        );
        client.setQueryData(qk.profile, next);
        return next;
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'PRECONDITION_FAILED') {
          await client.invalidateQueries({ queryKey: qk.profile });
        }
        throw err;
      }
    },
    [api, client],
  );
}

export function usePatchPreferences() {
  const api = useApi();
  const client = useQueryClient();
  return useCallback(
    async (patch: PreferencesPatch) => {
      const current = await client.ensureQueryData({
        queryKey: qk.preferences,
        queryFn: () => unwrap(api.GET('/v1/me/preferences')),
      });
      try {
        const next = await unwrap(
          api.PATCH('/v1/me/preferences', {
            params: { header: { 'If-Match': ifMatch(current.version) } },
            body: patch,
          }),
        );
        client.setQueryData(qk.preferences, next);
        return next;
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'PRECONDITION_FAILED') {
          await client.invalidateQueries({ queryKey: qk.preferences });
        }
        throw err;
      }
    },
    [api, client],
  );
}
