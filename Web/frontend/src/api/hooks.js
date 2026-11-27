import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from './client';
import { useToast } from '../components/common/Toast';

/** GET hook — key is the URL + params so every screen shares the same cache */
export const useApi = (url, params, options = {}) =>
  useQuery({ queryKey: [url, params || null], queryFn: () => get(url, params), enabled: Boolean(url), ...options });

/**
 * Mutation hook. After ANY successful write every cached query is refreshed, so a change in one module
 * (e.g. site live) immediately shows in the others (billing, dashboard, treasury) — end-to-end sync.
 */
export const useAction = (fn, { success, onSuccess } = {}) => {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (res, vars) => {
      await qc.invalidateQueries();
      const msg = typeof success === 'function' ? success(res, vars) : success || res?.message;
      if (msg) toast(msg);
      onSuccess?.(res, vars);
    },
    onError: (e) => toast(`⚠ ${e.message}`)
  });
};
