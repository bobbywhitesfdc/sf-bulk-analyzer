import { Connection } from '@salesforce/core';

import { parseCsv, splitCsvLine } from './csvParser.js';
import { pooled } from './pool.js';
import { isResultColumn, UploadField } from './uploadFields.js';

export type ApiVersion = 'v1' | 'v2';

export interface BulkJobInfo {
  apiVersion: ApiVersion;
  createdDate: string;
  errorMessage?: string;
  externalIdFieldName?: string;
  id: string;
  jobType: string;        // 'V2Ingest' | 'Classic'
  numberRecordsFailed: number;
  numberRecordsProcessed: number;
  object: string;
  operation: string;      // 'insert' | 'upsert' | 'delete' | 'query' | 'queryAll' | ...
  state: string;
  /** Upload column list recovered from the load (raw header names). Populated on demand. */
  uploadFields?: string[];
  /** Same columns, structurally classified (direct / externalIdLookup / recordType). */
  uploadFieldsClassified?: UploadField[];
}

export interface FailureRecord {
  error: string;
  fields: Record<string, string>;
  id: string;
}

export interface FetchOptions {
  concurrency?: number;            // worker pool size (default 15)
  onProgress?: (fetched: number, total: null | number) => void;
}

/**
 * Probe the v2 endpoint first; fall through to v1 if not found.
 */
export async function detectApiVersion(
  conn: Connection,
  jobId: string,
): Promise<ApiVersion> {
  const url = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${jobId}`;
  try {
    const response = await conn.requestGet<{ jobType?: string }>(url);
    if (response.jobType === 'V2Ingest') return 'v2';
  } catch {
    // 404 means v1 job
  }

  return 'v1';
}

export async function getJobInfo(
  conn: Connection,
  jobId: string,
  apiVersion: ApiVersion,
): Promise<BulkJobInfo> {
  type RawJob = {
    createdDate: string; errorMessage?: string; id: string; jobType: string;
    numberRecordsFailed: number; numberRecordsProcessed: number; object: string;
    operation: string; state: string;
  };
  if (apiVersion === 'v2') {
    const url = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${jobId}`;
    const data = await conn.requestGet<RawJob>(url);
    return { ...data, apiVersion: 'v2' };
  }

  const url = `${conn.instanceUrl}/services/async/${conn.version}/job/${jobId}`;
  const xml = await fetchV1Xml(conn, url);
  /* eslint-disable perfectionist/sort-objects -- intentional output key order, mirrors the v2 jobInfo field order */
  return {
    id: xmlValue(xml, 'id'),
    jobType: 'Classic',
    operation: xmlValue(xml, 'operation'),
    object: xmlValue(xml, 'object'),
    externalIdFieldName: xmlValue(xml, 'externalIdFieldName') || undefined,
    state: xmlValue(xml, 'state'),
    errorMessage: xmlValue(xml, 'errorMessage') || undefined,
    createdDate: xmlValue(xml, 'createdDate'),
    numberRecordsFailed: Number.parseInt(xmlValue(xml, 'numberRecordsFailed') || '0', 10),
    numberRecordsProcessed: Number.parseInt(xmlValue(xml, 'numberRecordsProcessed') || '0', 10),
    apiVersion: 'v1',
  };
  /* eslint-enable perfectionist/sort-objects */
}

export async function fetchFailures(
  conn: Connection,
  jobId: string,
  apiVersion: ApiVersion,
  opts: FetchOptions = {},
): Promise<FailureRecord[]> {
  if (apiVersion === 'v2') {
    return fetchFailuresV2(conn, jobId, opts);
  }

  return fetchFailuresV1(conn, jobId, opts);
}

function v1AuthHeaders(conn: Connection): Record<string, string> {
  return { 'X-SFDC-Session': conn.accessToken! };
}

function v2AuthHeaders(conn: Connection): Record<string, string> {
  return { Authorization: `Bearer ${conn.accessToken}` };
}

async function fetchV1Xml(conn: Connection, url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { ...v1AuthHeaders(conn), Accept: 'application/xml' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bulk API v1 request failed: ${res.status} ${res.statusText} — ${body}`);
  }

  return res.text();
}

function xmlValue(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return m ? m[1].trim() : '';
}

function xmlBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g');
  let m: null | RegExpExecArray;
  while ((m = re.exec(xml)) !== null) blocks.push(m[0]);
  return blocks;
}

async function fetchCsvRaw(
  conn: Connection,
  url: string,
  apiVersion: ApiVersion = 'v2',
): Promise<{ locator: null | string; text: string; }> {
  const authHeaders = apiVersion === 'v1' ? v1AuthHeaders(conn) : v2AuthHeaders(conn);
  const res = await fetch(url, {
    headers: { ...authHeaders, Accept: 'text/csv' },
  });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText} — ${url}`);
  const locator = res.headers.get('Sforce-Locator');
  return { locator, text: await res.text() };
}

/**
 * Read only the first line of a CSV response, streaming the body and stopping at
 * the first newline so we never download the full result set. Falls back to a
 * full read if the runtime gives us no streamable body.
 */
async function fetchCsvHeaderLine(
  conn: Connection,
  url: string,
  apiVersion: ApiVersion = 'v2',
): Promise<string> {
  const authHeaders = apiVersion === 'v1' ? v1AuthHeaders(conn) : v2AuthHeaders(conn);
  const res = await fetch(url, { headers: { ...authHeaders, Accept: 'text/csv' } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CSV header fetch failed: ${res.status} ${res.statusText} — ${url} — ${body}`);
  }

  if (!res.body) {
    const text = await res.text();
    return (text.split(/\r?\n/)[0] ?? '').replace(/\r$/, '');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      const nl = buf.indexOf('\n');
      if (nl !== -1) return buf.slice(0, nl).replace(/\r$/, '');
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return buf.replace(/\r$/, '');
}

/**
 * Recover the original upload column list for one job (one load).
 *
 *  - v2: read the successfulResults header (sf__Id, sf__Created, … then the
 *    uploaded columns). Job must be JobComplete for results to exist.
 *  - v1: read the first batch's submitted request CSV header. The request CSV is
 *    the raw upload, so there are no sf__* result columns to strip.
 *
 * Either way the result columns are filtered out, leaving the uploaded columns
 * verbatim (including dot-notation external-id and RecordType references).
 */
export async function fetchUploadFields(
  conn: Connection,
  jobId: string,
  apiVersion: ApiVersion,
): Promise<string[]> {
  return apiVersion === 'v1'
    ? fetchUploadFieldsV1(conn, jobId)
    : fetchUploadFieldsV2(conn, jobId);
}

async function fetchUploadFieldsV2(conn: Connection, jobId: string): Promise<string[]> {
  const url = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${jobId}/successfulResults`;
  const headerLine = await fetchCsvHeaderLine(conn, url, 'v2');
  if (!headerLine.trim()) return [];
  return splitCsvLine(headerLine).filter((c) => !isResultColumn(c));
}

async function fetchUploadFieldsV1(conn: Connection, jobId: string): Promise<string[]> {
  // No successfulResults for v1; the original upload is the batch /request payload.
  const batchListUrl = `${conn.instanceUrl}/services/async/${conn.version}/job/${jobId}/batch`;
  const batchListXml = await fetchV1Xml(conn, batchListUrl);
  const batchIds = xmlBlocks(batchListXml, 'batchInfo')
    .map((block) => xmlValue(block, 'id'))
    .filter(Boolean);
  if (batchIds.length === 0) return [];
  const url = `${conn.instanceUrl}/services/async/${conn.version}/job/${jobId}/batch/${batchIds[0]}/request`;
  const headerLine = await fetchCsvHeaderLine(conn, url, 'v1');
  if (!headerLine.trim()) return [];
  return splitCsvLine(headerLine).filter((c) => !isResultColumn(c));
}

async function fetchFailuresV2(
  conn: Connection,
  jobId: string,
  opts: FetchOptions,
): Promise<FailureRecord[]> {
  const base = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${jobId}/failedResults`;
  let locator: null | string = null;

  // V2 pages are sequential — each locator comes from the prior response header.
  let allRecords: FailureRecord[] = [];
  do {
    const url = locator ? `${base}?locator=${encodeURIComponent(locator)}` : base;
    const { locator: next, text } = await fetchCsvRaw(conn, url);
    allRecords = [...allRecords, ...parseCsv(text)];
    opts.onProgress?.(allRecords.length, null);
    locator = next === 'null' || !next ? null : next;
  } while (locator !== null);

  return allRecords;
}

async function fetchFailuresV1(
  conn: Connection,
  jobId: string,
  opts: FetchOptions,
): Promise<FailureRecord[]> {
  const concurrency = opts.concurrency ?? 15;

  const batchListUrl = `${conn.instanceUrl}/services/async/${conn.version}/job/${jobId}/batch`;
  const batchListXml = await fetchV1Xml(conn, batchListUrl);
  const batches = xmlBlocks(batchListXml, 'batchInfo').map((block) => ({ id: xmlValue(block, 'id') }));

  let fetched = 0;
  const tasks = batches.map((batch) => async () => {
    const url = `${conn.instanceUrl}/services/async/${conn.version}/job/${jobId}/batch/${batch.id}/result`;
    const { text } = await fetchCsvRaw(conn, url, 'v1');
    const rows = parseCsv(text).filter((r) => r.fields.Success === 'false');
    fetched += rows.length;
    opts.onProgress?.(fetched, null);
    return rows;
  });

  const results = await pooled(tasks, concurrency);
  return results.flat();
}

export async function listJobs(conn: Connection): Promise<BulkJobInfo[]> {
  const url = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest`;
  const data = await conn.requestGet<{ records: Array<BulkJobInfo & { jobType: string }> }>(url);
  return (data.records ?? []).map((r) => ({
    ...r,
    apiVersion: r.jobType === 'V2Ingest' ? 'v2' : 'v1',
  }));
}
