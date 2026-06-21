/**
 * Resolve the "object on the other end" for dot-notation upload columns.
 *
 * A header like `NameInsured.mm_member_id__c` tells us the relationship name
 * (`NameInsured`) and the external-id match field (`mm_member_id__c`), but the
 * consumer really wants to know which object it points to. A describe of the load
 * object answers that: the relationship resolves to a reference field
 * (`NameInsuredId`) whose referenceTo is the target object (`Account`).
 *
 * Scope is lookups + recordType only. Describes are cached per object so a
 * multi-load listing issues at most one describe per object.
 */

import { Connection } from '@salesforce/core';

import { UploadField } from './uploadFields.js';

export interface FieldLite {
  defaultedOnCreate: boolean;
  name: string;
  nillable: boolean;
  referenceTo?: null | string[];
  relationshipName?: null | string;
  type: string;
}

/** relationshipName(lowercased) -> field, per object. Values are promises so concurrent callers share one describe. */
export type DescribeCache = Map<string, Promise<Map<string, FieldLite>>>;

export function makeDescribeCache(): DescribeCache {
  return new Map();
}

async function relationshipMap(
  conn: Connection,
  object: string,
  cache: DescribeCache,
): Promise<Map<string, FieldLite>> {
  const key = object.toLowerCase();
  let pending = cache.get(key);
  if (!pending) {
    pending = conn.describe(object).then((desc) => {
      const map = new Map<string, FieldLite>();
      for (const f of desc.fields as unknown as FieldLite[]) {
        if (f.relationshipName) map.set(f.relationshipName.toLowerCase(), f);
      }

      return map;
    });
    cache.set(key, pending);
  }

  return pending;
}

/** Pure enrichment: attach target field/object/required to lookup + recordType columns. */
export function enrichFields(fields: UploadField[], relMap: Map<string, FieldLite>): UploadField[] {
  return fields.map((f) => {
    if (f.kind !== 'externalIdLookup' && f.kind !== 'recordType') return f;
    const field = f.relationshipName ? relMap.get(f.relationshipName.toLowerCase()) : undefined;
    if (!field?.referenceTo || field.referenceTo.length === 0) return f;
    const targetObject =
      field.referenceTo.length === 1 ? field.referenceTo[0] : field.referenceTo.join(', ');
    /* eslint-disable perfectionist/sort-objects -- key order is the documented JSON contract */
    return {
      ...f,
      targetField: field.name,
      targetObject,
      required: !field.nillable && !field.defaultedOnCreate,
    };
    /* eslint-enable perfectionist/sort-objects */
  });
}

/**
 * Resolve lookup/recordType targets for one load's fields. Returns the fields
 * unchanged if there is nothing to resolve or the describe fails.
 */
export async function resolveLookupTargets(
  conn: Connection,
  object: string,
  fields: UploadField[],
  cache: DescribeCache = makeDescribeCache(),
): Promise<UploadField[]> {
  const needsResolution = fields.some((f) => f.kind === 'externalIdLookup' || f.kind === 'recordType');
  if (!needsResolution) return fields;
  try {
    const relMap = await relationshipMap(conn, object, cache);
    return enrichFields(fields, relMap);
  } catch {
    return fields;
  }
}
