import { expect } from 'chai';
import { loadClassifiers } from '../../src/lib/classifierLoader.js';
import { buildClassifier } from '../../src/lib/errorClassifier.js';

const classifyError = buildClassifier(loadClassifiers());

describe('classifyError', () => {
  it('classifies INVALID_EMAIL_ADDRESS', () => {
    expect(classifyError('INVALID_EMAIL_ADDRESS: bad email')).to.equal('INVALID_EMAIL_ADDRESS');
  });

  it('classifies REQUIRED_FIELD_MISSING', () => {
    expect(classifyError('REQUIRED_FIELD_MISSING: Required fields are missing: [LastName]')).to.equal(
      'REQUIRED_FIELD_MISSING [LastName]',
    );
  });

  it('classifies INVALID_FIELD foreign key branch', () => {
    expect(
      classifyError('INVALID_FIELD:Foreign key external ID: 0000031236 not found for field Producer_BP_Id__c in entity Contact:--'),
    ).to.equal("INVALID_FIELD: foreign key Producer_BP_Id__c not found in Contact");
  });

  it('classifies INVALID_FIELD no-such-column branch', () => {
    expect(
      classifyError("INVALID_FIELD: No such column 'Foo__c' on sobject of type Contact"),
    ).to.equal("INVALID_FIELD: no column 'Foo__c' on Contact");
  });

  it('classifies DUPLICATE_VALUE', () => {
    expect(classifyError('DUPLICATE_VALUE: duplicate value found: [Id]')).to.equal(
      'DUPLICATE_VALUE [Id]',
    );
  });

  it('classifies INVALID_VALUE', () => {
    expect(classifyError('INVALID_VALUE: value not valid: Picklist:BadVal -- details')).to.equal(
      'INVALID_VALUE: BadVal',
    );
  });

  it('classifies INVALID_REFERENCE', () => {
    expect(classifyError('INVALID_REFERENCE: Related object is invalid: OwnerId is invalid: 005bad')).to.equal(
      'INVALID_REFERENCE: OwnerId',
    );
  });

  it('classifies FIELD_INTEGRITY_EXCEPTION', () => {
    expect(classifyError('FIELD_INTEGRITY_EXCEPTION: (custom field) Foo__c')).to.equal(
      'FIELD_INTEGRITY_EXCEPTION: Foo__c',
    );
  });

  it('classifies MISSING_ARGUMENT', () => {
    expect(classifyError('MISSING_ARGUMENT:Agency_BP_Id__c not specified:--')).to.equal(
      'MISSING_ARGUMENT: Agency_BP_Id__c',
    );
  });

  it('returns UNKNOWN for unrecognized error', () => {
    expect(classifyError('some random message')).to.equal('UNKNOWN');
  });
});
