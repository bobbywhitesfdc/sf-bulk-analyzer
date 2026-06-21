/* eslint-disable perfectionist/sort-objects -- key order of the emitted Summary / level1 / level2 objects is an intentional JSON output contract, not alphabetical */
import { BulkJobInfo, FailureRecord } from './bulkApiClient.js';

export interface SignatureGroup {
  count: number;
  examples: string[];
  signature: string;
}

export interface Summary {
  level1: SignatureGroup[]; // grouped by normalized signature, desc by count
  level2: Array<{ error: string; id: string; }>; // raw messages, top N
  sampled: boolean;
  sampleSize?: number;
  totalFailures: number;
}

const MAX_LEVEL2_ROWS = 20;
const MAX_EXAMPLES_PER_SIG = 3;

export function summarize(
  records: FailureRecord[],
  sampled: boolean,
  classifyError: (error: string) => string,
): Summary {
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

export function formatSummary(summary: Summary, jobId: string, jobInfo?: Pick<BulkJobInfo, 'errorMessage' | 'externalIdFieldName' | 'object' | 'operation' | 'state'>): string {
  const lines: string[] = [];
  lines.push(`=== Bulk Job ${jobId} — Failure Analysis ===`);
  if (jobInfo) {
    const upsertField = jobInfo.operation === 'upsert' && jobInfo.externalIdFieldName ? ` (${jobInfo.externalIdFieldName})` : '';
    lines.push(`Object: ${jobInfo.object}    Operation: ${jobInfo.operation}${upsertField}`, `State: ${jobInfo.state}`);
    if (jobInfo.errorMessage) {
      lines.push(`Job Error: ${jobInfo.errorMessage}`);
    }
  }

  lines.push(`Total failures: ${summary.totalFailures}${summary.sampled ? ` (sampled ${summary.sampleSize})` : ''}`, '', '--- Level 1: By Error Signature ---');
  for (const g of summary.level1) {
    lines.push(`  ${g.count.toString().padStart(6)}  ${g.signature}`);
  }

  lines.push('', `--- Level 2: Sample of Raw Messages (first ${MAX_LEVEL2_ROWS}) ---`);
  for (const r of summary.level2) {
    lines.push(`  [${r.id}] ${r.error}`);
  }

  return lines.join('\n');
}
