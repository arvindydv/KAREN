/** Usage accounting helpers (moved from conversation/chat-policy.ts in M5a; behaviour unchanged). */
export const MICRO_USD_PER_USD = 1_000_000;

/** USD → integer micro-USD, rounded UP (never under-charge a reservation). */
export const usdToMicro = (usd: number): number => Math.ceil(usd * MICRO_USD_PER_USD);

export function usagePeriods(now: Date) {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  const month = day.slice(0, 6);
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayReset = new Date(dayStart.getTime() + 86_400_000);
  const monthReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { day, month, dayStart, monthStart, dayReset, monthReset };
}
