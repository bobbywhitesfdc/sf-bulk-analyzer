import { Connection } from '@salesforce/core';
import { parseCsv } from './csvParser.js';
import { pooled } from './pool.js';

export type ApiVersion = 'v1' | 'v2';

export interface BulkJobInfo {
  id: string;
  apiVersion: ApiVersion;
  jobType: string;        // 'V2Ingest' | 'Classic'
  operation: string;      // 'insert' | 'upsert' | 'delete' | 'query' | 'queryAll' | ...
  object: string;
  externalIdFieldName?: string;
  state: string;
  createdDate: string;
  numberRecordsFailed: number;
  numberRecordsProcessed: number;
}

export interface FailureRecord {
  id: string;
  error: string;
  fields: Record<string, string>;
}

export interface FetchOptions {
  concurrency?: number;            // worker pool size (default 15)
  onProgress?: (fetched: number, total: number | null) => void;
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
    id: string; jobType: string; operation: string; object: string;
    state: string; createdDate: string;
    numberRecordsFailed: number; numberRecordsProcessed: number;
  };
  if (apiVersion === 'v2') {
    const url = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${jobId}`;
    const data = await conn.requestGet<RawJob>(url);
    return { ...data, apiVersion: 'v2' };
  }
  const url = `${conn.instanceUrl}/services/async/${conn.version}/job/${jobId}`;
  const xml = await fetchV1Xml(conn, url);
  return {
    id: xmlValue(xml, 'id'),
    jobType: 'Classic',
    operation: xmlValue(xml, 'operation'),
    object: xmlValue(xml, 'object'),
    externalIdFieldName: xmlValue(xml, 'externalIdFieldName') || undefined,
    state: xmlValue(xml, 'state'),
    createdDate: xmlValue(xml, 'createdDate'),
    numberRecordsFailed: parseInt(xmlValue(xml, 'numberRecordsFailed') || '0', 10),
    numberRecordsProcessed: parseInt(xmlValue(xml, 'numberRecordsProcessed') || '0', 10),
    apiVersion: 'v1',
  };
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
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) blocks.push(m[0]);
  return blocks;
}

async function fetchCsvRaw(
  conn: Connection,
  url: string,
  apiVersion: ApiVersion = 'v2',
): Promise<{ text: string; locator: string | null }> {
  const authHeaders = apiVersion === 'v1' ? v1AuthHeaders(conn) : v2AuthHeaders(conn);
  const res = await fetch(url, {
    headers: { ...authHeaders, Accept: 'text/csv' },
  });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText} — ${url}`);
  const locator = res.headers.get('Sforce-Locator');
  return { text: await res.text(), locator };
}

async function fetchFailuresV2(
  conn: Connection,
  jobId: string,
  opts: FetchOptions,
): Promise<FailureRecord[]> {
  const base = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${jobId}/failedResults`;
  const records: FailureRecord[] = [];
  let locator: string | null = null;

  // V2 pages are sequential — each locator comes from the prior response header.
  let allRecords: FailureRecord[] = [];
  do {
    const url = locator ? `${base}?locator=${encodeURIComponent(locator)}` : base;
    const { text, locator: next } = await fetchCsvRaw(conn, url);
    allRecords = allRecords.concat(parseCsv(text));
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
    const rows = parseCsv(text).filter((r) => r.fields['Success'] === 'false');
    fetched += rows.length;
    opts.onProgress?.(fetched, null);
    return rows;
  });

  const results = await pooled(tasks, concurrency);
  return ([] as FailureRecord[]).concat(...results);
}

export async function listJobs(conn: Connection): Promise<BulkJobInfo[]> {
  const url = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest`;
  const data = await conn.requestGet<{ records: Array<BulkJobInfo & { jobType: string }> }>(url);
  return (data.records ?? []).map((r) => ({
    ...r,
    apiVersion: r.jobType === 'V2Ingest' ? 'v2' : 'v1',
  }));
}
