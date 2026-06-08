import { Connection } from '@salesforce/core';
import { parseCsv } from './csvParser.js';

export type ApiVersion = 'v1' | 'v2';

export interface BulkJobInfo {
  id: string;
  apiVersion: ApiVersion;
  jobType: string;        // 'V2Ingest' | 'Classic'
  operation: string;      // 'insert' | 'upsert' | 'delete' | 'query' | 'queryAll' | ...
  object: string;
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

/**
 * Probe the v2 endpoint first; fall through to v1 if not found.
 * Mirrors the detection logic in analyze_bulk_job.sh.
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
    // 404 means job not found on v2 endpoint — fall through to v1
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
  const data = await conn.requestGet<RawJob>(url);
  return { ...data, apiVersion: 'v1' };
}

export async function fetchFailures(
  conn: Connection,
  jobId: string,
  apiVersion: ApiVersion,
): Promise<FailureRecord[]> {
  if (apiVersion === 'v2') {
    return fetchFailuresV2(conn, jobId);
  }
  return fetchFailuresV1(conn, jobId);
}

async function fetchCsv(conn: Connection, url: string): Promise<string> {
  const token = conn.accessToken;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/csv' },
  });
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

async function fetchFailuresV2(
  conn: Connection,
  jobId: string,
): Promise<FailureRecord[]> {
  const url = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest/${jobId}/failedResults`;
  const csv = await fetchCsv(conn, url);
  return parseCsv(csv);
}

async function fetchFailuresV1(
  conn: Connection,
  jobId: string,
): Promise<FailureRecord[]> {
  // Enumerate batches, then download each batch's result CSV and filter failures.
  const batchListUrl = `${conn.instanceUrl}/services/async/${conn.version}/job/${jobId}/batch`;
  const batchList = await conn.requestGet<{ batchInfo: Array<{ id: string }> }>(batchListUrl);
  const batches = Array.isArray(batchList.batchInfo)
    ? batchList.batchInfo
    : [batchList.batchInfo];

  const failures: FailureRecord[] = [];
  for (const batch of batches) {
    const resultUrl = `${conn.instanceUrl}/services/async/${conn.version}/job/${jobId}/batch/${batch.id}/result`;
    const csv = await fetchCsv(conn, resultUrl);
    const rows = parseCsv(csv);
    // v1 result CSVs include a "Success" column; keep only failures.
    for (const row of rows) {
      if (row.fields['Success'] === 'false') {
        failures.push({ id: row.id, error: row.error, fields: row.fields });
      }
    }
  }
  return failures;
}

export async function listJobs(conn: Connection): Promise<BulkJobInfo[]> {
  const url = `${conn.instanceUrl}/services/data/v${conn.version}/jobs/ingest`;
  const data = await conn.requestGet<{ records: Array<BulkJobInfo & { jobType: string }> }>(url);
  return (data.records ?? []).map((r) => ({
    ...r,
    apiVersion: r.jobType === 'V2Ingest' ? 'v2' : 'v1',
  }));
}

