/** Provider counts only. Context-budget heuristics are not billable usage. */
export function providerUsage(usage: unknown) {
  const data = usage as { prompt_tokens?: number; completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } } | undefined;
  const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const inputTokens = count(data?.prompt_tokens);
  const outputTokens = count(data?.completion_tokens);
  const cachedTokens = count(data?.prompt_tokens_details?.cached_tokens);
  const cacheWriteTokens = count(data?.prompt_tokens_details?.cache_write_tokens);
  const rate = (name: string): number | null => {
    const raw = process.env[name];
    if (raw === undefined || !raw.trim()) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const inputRate = rate('ASQ_MODEL_INPUT_COST_MICROS_PER_1K');
  const outputRate = rate('ASQ_MODEL_OUTPUT_COST_MICROS_PER_1K');
  const cachedRate = rate('ASQ_MODEL_CACHED_COST_MICROS_PER_1K');
  const writeRate = rate('ASQ_MODEL_CACHE_WRITE_COST_MICROS_PER_1K');
  let estimatedCostMicros: number | null = null;
  if (inputTokens !== null && outputTokens !== null && cachedTokens !== null && cacheWriteTokens !== null &&
      cachedTokens + cacheWriteTokens <= inputTokens && inputRate !== null && outputRate !== null &&
      (cachedTokens === 0 || cachedRate !== null) && (cacheWriteTokens === 0 || writeRate !== null)) {
    const value = Math.ceil(((inputTokens-cachedTokens-cacheWriteTokens)*inputRate + outputTokens*outputRate +
      cachedTokens*(cachedRate ?? 0) + cacheWriteTokens*(writeRate ?? 0))/1000);
    if (Number.isSafeInteger(value)) estimatedCostMicros = value;
  }
  return { inputTokens, outputTokens, cachedTokens, cacheWriteTokens, estimatedCostMicros };
}
