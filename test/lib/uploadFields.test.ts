import { expect } from 'chai';
import {
  classifyUploadField,
  classifyUploadFields,
  isResultColumn,
  annotateUploadField,
} from '../../src/lib/uploadFields.js';
import { enrichFields, FieldLite } from '../../src/lib/schemaResolver.js';

describe('classifyUploadField', () => {
  it('classifies a plain field as direct', () => {
    expect(classifyUploadField('MM_Member_Id__c')).to.deep.equal({
      raw: 'MM_Member_Id__c',
      kind: 'direct',
    });
  });

  it('classifies a __pc (person account) field as a direct write', () => {
    expect(classifyUploadField('MM_Member_Id__pc').kind).to.equal('direct');
  });

  it('classifies dot notation as an external-id lookup', () => {
    expect(classifyUploadField('NameInsured.mm_member_id__c')).to.deep.equal({
      raw: 'NameInsured.mm_member_id__c',
      kind: 'externalIdLookup',
      relationshipName: 'NameInsured',
      matchField: 'mm_member_id__c',
    });
  });

  it('classifies RecordType.Name as record type, not external-id (case-insensitive)', () => {
    const f = classifyUploadField('RecordType.Name');
    expect(f.kind).to.equal('recordType');
    expect(f.relationshipName).to.equal('RecordType');
    expect(f.matchField).to.equal('Name');
    // lowercase relationship still recognized
    expect(classifyUploadField('recordtype.Name').kind).to.equal('recordType');
  });

  it('trims surrounding whitespace from the header', () => {
    expect(classifyUploadField('  FirstName ').raw).to.equal('FirstName');
  });
});

describe('isResultColumn', () => {
  it('flags Bulk/loader result columns (including the v1 loader-added Id)', () => {
    for (const c of ['sf__Id', 'sf__Created', 'sf__Error', 'sf__Unprocessed', 'Id']) {
      expect(isResultColumn(c), c).to.be.true;
    }
  });
  it('does not flag upload columns', () => {
    expect(isResultColumn('Name')).to.be.false;
  });
});

describe('classifyUploadFields strips the v1 loader-added Id column', () => {
  it('drops a leading Id from a v1 request header', () => {
    const headers = ['Id', 'Name', 'Account.Agency_BP_Id__c', 'Producer_External_Id__c'];
    expect(classifyUploadFields(headers).map((f) => f.raw)).to.deep.equal([
      'Name',
      'Account.Agency_BP_Id__c',
      'Producer_External_Id__c',
    ]);
  });
});

describe('classifyUploadFields (real FSCDEMO headers)', () => {
  it('handles the InsurancePolicyParticipant header', () => {
    const headers = [
      'sf__Id',
      'sf__Created',
      'InsurancePolicy.Agreement_Key__c',
      'PrimaryParticipantAccount.MM_Member_Id__c',
      'Policy_Participant_External_Id__c',
      'ParticipantName',
      'Role',
    ];
    const fields = classifyUploadFields(headers);
    // result columns dropped
    expect(fields).to.have.length(5);
    expect(fields.map((f) => f.kind)).to.deep.equal([
      'externalIdLookup',
      'externalIdLookup',
      'direct',
      'direct',
      'direct',
    ]);
  });

  it('handles the Account header with RecordType and person account fields', () => {
    const headers = ['sf__Id', 'sf__Created', 'FirstName', 'LastName', 'MM_Member_Id__c', 'MM_Member_Id__pc', 'RecordType.Name'];
    const fields = classifyUploadFields(headers);
    const byRaw = Object.fromEntries(fields.map((f) => [f.raw, f.kind]));
    expect(byRaw).to.deep.equal({
      FirstName: 'direct',
      LastName: 'direct',
      MM_Member_Id__c: 'direct',
      MM_Member_Id__pc: 'direct', // __pc fields are direct writes (no separate kind)
      'RecordType.Name': 'recordType',
    });
  });
});

describe('enrichFields (lookup target resolution)', () => {
  // Mirrors the real InsurancePolicy describe: NameInsured -> NameInsuredId -> Account (required).
  const relMap = new Map<string, FieldLite>([
    ['nameinsured', { name: 'NameInsuredId', type: 'reference', relationshipName: 'NameInsured', referenceTo: ['Account'], nillable: false, defaultedOnCreate: false }],
    ['recordtype', { name: 'RecordTypeId', type: 'reference', relationshipName: 'RecordType', referenceTo: ['RecordType'], nillable: false, defaultedOnCreate: true }],
  ]);

  it('resolves an external-id lookup to its target field/object and requiredness', () => {
    const [f] = enrichFields(classifyUploadFields(['NameInsured.mm_member_id__c']), relMap);
    expect(f).to.include({
      kind: 'externalIdLookup',
      relationshipName: 'NameInsured',
      matchField: 'mm_member_id__c',
      targetField: 'NameInsuredId',
      targetObject: 'Account',
      required: true,
    });
  });

  it('resolves recordType (defaulted-on-create => not required)', () => {
    const [f] = enrichFields(classifyUploadFields(['RecordType.Name']), relMap);
    expect(f).to.include({ targetField: 'RecordTypeId', targetObject: 'RecordType', required: false });
  });

  it('leaves direct fields and unknown relationships untouched', () => {
    const fields = enrichFields(classifyUploadFields(['Name', 'Bogus.ext__c']), relMap);
    expect(fields[0]).to.not.have.property('targetObject');
    expect(fields[1]).to.not.have.property('targetObject');
  });
});

describe('annotateUploadField', () => {
  it('annotates a record type field as a lookup by Name', () => {
    expect(annotateUploadField(classifyUploadField('RecordType.Name'))).to.equal('lookup → RecordType by Name');
  });
  it('annotates an external-id lookup by its match field', () => {
    expect(annotateUploadField(classifyUploadField('Account.Agency_BP_Id__c'))).to.equal(
      'lookup → Account by Agency_BP_Id__c',
    );
  });
  it('returns empty annotation for a direct field', () => {
    expect(annotateUploadField(classifyUploadField('Name'))).to.equal('');
  });
});
