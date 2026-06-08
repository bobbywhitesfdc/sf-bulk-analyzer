import { expect } from 'chai';
import { classifyError } from '../../src/lib/errorClassifier.js';

describe('classifyError', () => {
  it('classifies INVALID_EMAIL_ADDRESS', () => {
    expect(classifyError('INVALID_EMAIL_ADDRESS: bad email')).to.equal('INVALID_EMAIL_ADDRESS');
  });

  it('classifies REQUIRED_FIELD_MISSING', () => {
    expect(classifyError('REQUIRED_FIELD_MISSING: Required fields are missing: [LastName]')).to.equal(
      'REQUIRED_FIELD_MISSING [LastName]',
    );
  });

  it('classifies INVALID_FIELD with foreign key branch', () => {
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

  it('classifies UNKNOWN with custom field tokens', () => {
    const result = classifyError('some error mentioning MyField__c in entity Account');
    expect(result).to.include('MyField__c');
    expect(result).to.include('entity:Account');
  });

  it('returns UNKNOWN for unrecognized error', () => {
    expect(classifyError('some random message')).to.equal('UNKNOWN');
  });
});
