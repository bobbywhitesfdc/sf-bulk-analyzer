import { Args } from '@oclif/core';
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FailureRecord } from '../../lib/bulkApiClient.js';
import { parseCsv } from '../../lib/csvParser.js';
import { shouldSample, sample } from '../../lib/sampler.js';
import { summarize, formatSummary } from '../../lib/summarizer.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);

export default class BulkAnalyzeFiles extends SfCommand<object> {
  public static readonly summary = 'Analyze locally downloaded Bulk API failure CSVs without an org connection.';

  public static readonly examples = [
    '$ sf bulk analyze-files ./bulk_analysis_750xx0000000001',
    '$ sf bulk analyze-files ./bulk_analysis_750xx0000000001 --json',
  ];

  public static readonly flags = {
    'sample-size': Flags.integer({
      summary: 'Max records to include in sample.',
      default: 500,
    }),
    'sample-threshold': Flags.integer({
      summary: 'Failure % that triggers sampling.',
      default: 80,
    }),
  };

  public static readonly args = {
    dir: Args.directory({ description: 'Directory containing failure CSV files.', required: true }),
  };

  public async run(): Promise<object> {
    const { args, flags } = await this.parse(BulkAnalyzeFiles);
    const dir = args.dir;

    const entries = await readdir(dir);
    const csvFiles = entries.filter((f) => f.endsWith('.csv'));
    if (csvFiles.length === 0) this.error(`No CSV files found in ${dir}`);

    let records: FailureRecord[] = [];
    for (const file of csvFiles) {
      const content = await readFile(join(dir, file), 'utf8');
      records.push(...parseCsv(content));
    }

    const doSample = shouldSample(records.length, records.length, flags['sample-threshold']);
    if (doSample) {
      records = sample(records, flags['sample-size']);
      this.warn(`Large failure set — analyzing stratified sample of ${records.length} records.`);
    }

    const jobId = dir.replace(/.*bulk_analysis_/, '').replace(/\/$/, '');
    const summary = summarize(records, doSample);

    if (!this.jsonEnabled()) {
      this.log(formatSummary(summary, jobId));
    }

    return { dir, summary };
  }
}
