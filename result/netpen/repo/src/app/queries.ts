import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, toValue, type MaybeRefOrGetter } from 'vue';

import {
  QUERY_KEYS,
  type RecordCountRequest,
  type RecordMortalityRequest,
  type RecordTreatmentRequest,
} from '@/data/api';
import { NotFoundError, RefusedError } from '@/data/api';
import { ApiError } from '@/data/http';

import { useApi } from './api';
import { useClock } from './clock';

/**
 * Typed access to the API through vue-query.
 *
 * Everything time dependent keys off the clock bucket rather than the raw
 * instant, so a tick invalidates once and the whole page moves together
 * instead of each row refetching on its own schedule.
 */

export const STALE_AFTER_MS = 30_000;
export const GC_AFTER_MS = 10 * 60_000;
export const MAX_RETRIES = 3;

/**
 * A dropped link is worth retrying; a refusal is not. Retrying a rejected lice
 * count three times only delays the message the crew need to read.
 */
export function isWorthRetrying(error: unknown): boolean {
  if (error instanceof NotFoundError || error instanceof RefusedError) return false;
  if (error instanceof ApiError) return error.isRetryable;
  return true;
}

export function retryDelayMs(attempt: number): number {
  // 600, 1200, 2400, capped. Long enough to ride out a squall, short enough
  // that the terminal does not look frozen.
  return Math.min(600 * 2 ** attempt, 6_000);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_AFTER_MS,
        gcTime: GC_AFTER_MS,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount: number, error: unknown) =>
          failureCount < MAX_RETRIES && isWorthRetrying(error),
        retryDelay: retryDelayMs,
      },
      mutations: {
        // A failed write is shown to the crew, who decide. Retrying a count
        // automatically would be a way to file it twice.
        retry: false,
      },
    },
  });
}

export function useSite() {
  const api = useApi();
  return useQuery({ queryKey: QUERY_KEYS.site, queryFn: () => api.getSite() });
}

export function usePens() {
  const api = useApi();
  return useQuery({ queryKey: QUERY_KEYS.pens, queryFn: () => api.listPens() });
}

export function usePeople() {
  const api = useApi();
  return useQuery({ queryKey: QUERY_KEYS.people, queryFn: () => api.listPeople() });
}

export function useGeneration() {
  const api = useApi();
  return useQuery({ queryKey: QUERY_KEYS.generation, queryFn: () => api.getGeneration() });
}

export function usePenBoard() {
  const api = useApi();
  const { now, bucket } = useClock();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.penBoard(bucket.value)),
    queryFn: () => api.listPenBoard(now.value),
  });
}

export function usePen(penId: MaybeRefOrGetter<string>) {
  const api = useApi();
  const { now, bucket } = useClock();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.pen(toValue(penId), bucket.value)),
    queryFn: () => api.getPen(toValue(penId), now.value),
  });
}

export function useSiteView() {
  const api = useApi();
  const { now, bucket } = useClock();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.siteView(bucket.value)),
    queryFn: () => api.getSiteView(now.value),
  });
}

export function useStockEvents(groupId: MaybeRefOrGetter<string>) {
  const api = useApi();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.stockEvents(toValue(groupId))),
    queryFn: () => api.listStockEvents(toValue(groupId)),
    // The log is append only, so a stale window costs nothing and saves a lot
    // of refolding when moving between tabs on a pen page.
    staleTime: 120_000,
  });
}

export function useLiceCounts(penId: MaybeRefOrGetter<string | null>) {
  const api = useApi();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.liceCounts(toValue(penId))),
    queryFn: () => api.listLiceCounts(toValue(penId)),
  });
}

export function useTreatments(penId: MaybeRefOrGetter<string | null>) {
  const api = useApi();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.treatments(toValue(penId))),
    queryFn: () => api.listTreatments(toValue(penId)),
  });
}

/**
 * Oxygen for one pen over a window. The window is part of the key, so moving
 * the range on the water screen fetches rather than filtering a series the
 * client never had all of.
 */
export function useOxygen(
  penId: MaybeRefOrGetter<string | null>,
  from: MaybeRefOrGetter<number>,
  to: MaybeRefOrGetter<number>,
) {
  const api = useApi();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.oxygen(toValue(penId) ?? '', toValue(from), toValue(to))),
    queryFn: () => api.listOxygen(toValue(penId) ?? '', toValue(from), toValue(to)),
    enabled: computed(() => toValue(penId) !== null),
  });
}

export function useTemperatures(depthM: MaybeRefOrGetter<number>) {
  const api = useApi();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.temperatures(toValue(depthM))),
    queryFn: () => api.listTemperatures(toValue(depthM)),
    staleTime: 300_000,
  });
}

export function useAlerts() {
  const api = useApi();
  const { now, bucket } = useClock();
  return useQuery({
    queryKey: computed(() => QUERY_KEYS.alerts(bucket.value)),
    queryFn: () => api.listAlerts(now.value),
  });
}

/** Everything time dependent, invalidated together after a write. */
function invalidateLive(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return (
        head === 'pen-board' ||
        head === 'pen' ||
        head === 'site-view' ||
        head === 'alerts' ||
        head === 'lice-counts' ||
        head === 'treatments' ||
        head === 'stock-events'
      );
    },
  });
}

export function useRecordCount() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: RecordCountRequest) => api.recordCount(request),
    onSuccess: () => invalidateLive(client),
  });
}

export function useRecordTreatment() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: RecordTreatmentRequest) => api.recordTreatment(request),
    onSuccess: () => invalidateLive(client),
  });
}

export function useRecordMortality() {
  const api = useApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: RecordMortalityRequest) => api.recordMortality(request),
    onSuccess: () => invalidateLive(client),
  });
}

export function useAcknowledgeAlert() {
  const api = useApi();
  const client = useQueryClient();
  const { now } = useClock();
  return useMutation({
    mutationFn: ({ alertId, personId }: { alertId: string; personId: string }) =>
      api.acknowledgeAlert(alertId, personId, now.value),
    onSuccess: () => invalidateLive(client),
  });
}
