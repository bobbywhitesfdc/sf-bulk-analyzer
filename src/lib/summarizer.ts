import { FailureRecord } from './bulkApiClient.js';
import { classifyError } from './errorClassifier.js';

export interface SignatureGroup {
  signature: string;
  count: number;
  examples: string[];
}

export interface Summary {
  totalFailures: number;
  sampled: boolean;
  sampleSize?: number;
  level1: SignatureGroup[]; // grouped by normalized signature, desc by count
  level2: Array<{ id: string; error: string }>; // raw messages, top N
}

const MAX_LEVEL2_ROWS = 20;
const MAX_EXAMPLES_PER_SIG = 3;

export function summarize(records: FailureRecord[], sampled: boolean): Summary {
  const sigMap = new Map<string, SignatureGroup>();

  for (const rec of records) {
    const sig = classifyError(rec.error);
    const group = sigMap.get(sig);
    if (group) {
      group.count++;
      if (group.examples.length < MAX_EXAMPLES_PER_SIG) group.examples.push(rec.error);
    } else {
      sigMap.set(sig, { signature: sig, count: 1, examples: [rec.error] });
    }
  }

  const level1 = [...sigMap.values()].sort((a, b) => b.count - a.count);
  const level2 = records.slice(0, MAX_LEVEL2_ROWS).map((r) => ({ id: r.id, error: r.error }));

  return {
    totalFailures: records.length,
    sampled,
    sampleSize: sampled ? records.length : undefined,
    level1,
    level2,
  };
}

export function formatSummary(summary: Summary, jobId: string): string {
  const lines: string[] = [];
  lines.push(`=== Bulk Job ${jobId} — Failure Analysis ===`);
  lines.push(`Total failures: ${summary.totalFailures}${summary.sampled ? ` (sampled ${summary.sampleSize})` : ''}`);
  lines.push('');
  lines.push('--- Level 1: By Error Signature ---');
  for (const g of summary.level1) {
    lines.push(`  ${g.count.toString().padStart(6)}  ${g.signature}`);
  }
  lines.push('');
  lines.push(`--- Level 2: Sample of Raw Messages (first ${MAX_LEVEL2_ROWS}) ---`);
  for (const r of summary.level2) {
    lines.push(`  [${r.id}] ${r.error}`);
  }
  return lines.join('\n');
}
