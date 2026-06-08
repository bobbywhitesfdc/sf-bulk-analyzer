import { FailureRecord } from './bulkApiClient.js';

export function parseCsv(csv: string): FailureRecord[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const idIdx = headers.findIndex((h) => h === 'sf__Id' || h === 'Id');
  const errIdx = headers.findIndex((h) => h === 'sf__Error' || h === 'Error');

  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const fields: Record<string, string> = {};
    headers.forEach((h, i) => {
      fields[h] = cols[i] ?? '';
    });
    return {
      id: idIdx >= 0 ? (cols[idIdx] ?? '') : '',
      error: errIdx >= 0 ? (cols[errIdx] ?? '') : '',
      fields,
    };
  });
}

export function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}
