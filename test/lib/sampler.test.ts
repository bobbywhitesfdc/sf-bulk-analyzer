import { expect } from 'chai';

import { FailureRecord } from '../../src/lib/bulkApiClient.js';
import { sample, shouldSample } from '../../src/lib/sampler.js';

function makeRecords(n: number): FailureRecord[] {
  return Array.from({ length: n }, (_, i) => ({ error: `err${i}`, fields: {}, id: `id${i}` }));
}

describe('shouldSample', () => {
  it('triggers when failures exceed 10k', () => {
    expect(shouldSample(10_001, 20_000)).to.be.true;
  });

  it('triggers when failure rate exceeds threshold', () => {
    expect(shouldSample(9000, 10_000, 80)).to.be.true;
  });

  it('does not trigger below threshold', () => {
    expect(shouldSample(100, 10_000, 80)).to.be.false;
  });
});

describe('sample', () => {
  it('returns all records when count <= size', () => {
    const records = makeRecords(100);
    expect(sample(records, 500)).to.have.length(100);
  });

  it('returns exactly size records when count > size', () => {
    const records = makeRecords(50_000);
    expect(sample(records, 500)).to.have.length(500);
  });

  it('covers the full range (first and near-last included)', () => {
    const records = makeRecords(10_000);
    const result = sample(records, 500);
    expect(result[0].id).to.equal('id0');
    expect(Number.parseInt(result.at(-1)!.id.slice(2), 10)).to.be.greaterThan(9000);
  });
});
