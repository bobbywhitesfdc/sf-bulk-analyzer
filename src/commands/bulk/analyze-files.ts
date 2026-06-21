import { Args } from '@oclif/core';
import { Flags, SfCommand } from '@salesforce/sf-plugins-core';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FailureRecord } from '../../lib/bulkApiClient.js';
import { loadClassifiers } from '../../lib/classifierLoader.js';
import { parseCsv } from '../../lib/csvParser.js';
import { buildClassifier } from '../../lib/errorClassifier.js';
import { sample, shouldSample } from '../../lib/sampler.js';
import { formatSummary, summarize } from '../../lib/summarizer.js';

export default class BulkAnalyzeFiles extends SfCommand<object> {
  public static readonly args = {
    dir: Args.directory({ description: 'Directory containing failure CSV files.', required: true }),
  };
public static readonly examples = [
    '$ sf bulk analyze-files ./bulk_analysis_750xx0000000001',
    '$ sf bulk analyze-files ./bulk_analysis_750xx0000000001 --json',
  ];
public static readonly flags = {
    classifiers: Flags.file({
      default: undefined,
      summary: 'Path to a custom classifiers YAML file.',
    }),
    'sample-size': Flags.integer({
      default: 500,
      summary: 'Max records to include in sample.',
    }),
    'sample-threshold': Flags.integer({
      default: 80,
      summary: 'Failure % that triggers sampling.',
    }),
  };
public static readonly summary = 'Analyze locally downloaded Bulk API failure CSVs without an org connection.';

  public async run(): Promise<object> {
    const { args, flags } = await this.parse(BulkAnalyzeFiles);
    const {dir} = args;
    const classifyError = buildClassifier(loadClassifiers(flags.classifiers));

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
    const summary = summarize(records, doSample, classifyError);

    if (!this.jsonEnabled()) {
      this.log(formatSummary(summary, jobId));
    }

    return { dir, summary };
  }
}
