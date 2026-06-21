import { FailureRecord } from './bulkApiClient.js';

export const DEFAULT_SAMPLE_SIZE = 500;
export const DEFAULT_SAMPLE_THRESHOLD_PCT = 80;

export function shouldSample(
  failureCount: number,
  processedCount: number,
  thresholdPct = DEFAULT_SAMPLE_THRESHOLD_PCT,
  sampleSize = DEFAULT_SAMPLE_SIZE,
): boolean {
  if (failureCount > 10_000) return true;
  if (failureCount > sampleSize && processedCount > 0 && (failureCount / processedCount) * 100 > thresholdPct) return true;
  return false;
}

// Evenly-spaced stratified sample — picks every Nth record to cover the full range.
export function sample(records: FailureRecord[], size = DEFAULT_SAMPLE_SIZE): FailureRecord[] {
  if (records.length <= size) return records;
  const step = records.length / size;
  const result: FailureRecord[] = [];
  for (let i = 0; i < size; i++) {
    result.push(records[Math.floor(i * step)]);
  }

  return result;
}
