/**
 * Structural classification of Bulk ingest upload columns.
 *
 * The Bulk v2 successfulResults endpoint echoes the original upload CSV header,
 * which tells us exactly which fields an ETL writes per object. Header columns
 * fall into a few shapes, classified by how Bulk resolves the value:
 *
 *   - direct field:        MM_Member_Id__c (person-account __pc fields are direct too)
 *   - external-id lookup:  NameInsured.mm_member_id__c   (resolves NameInsuredId)
 *   - record type:         RecordType.Name              (resolves RecordTypeId)
 *
 * RecordType.* is the exception to "dot notation == external id": it matches the
 * RecordType *Label* (the Name field), not DeveloperName. Full resolution of the
 * actual target field, type, and requiredness needs a describe — see schemaDescribe
 * (Item 2). This module is pure/structural and does no network I/O.
 */

export type UploadFieldKind = 'direct' | 'externalIdLookup' | 'recordType';

export interface UploadField {
  kind: UploadFieldKind;
  /** Field after the dot. For externalIdLookup this is the external-id match field; for recordType it is the match field (typically 'Name'). */
  matchField?: string;
  /** Original header column, verbatim. */
  raw: string;
  /** Relationship name before the dot (e.g. 'NameInsured', 'RecordType'). */
  relationshipName?: string;
  /** Whether that target field is required on the load object. */
  required?: boolean;
  // --- Resolved from a describe (lookups/recordType only); see schemaResolver ---
  /** The actual lookup field this column populates, e.g. 'NameInsuredId'. */
  targetField?: string;
  /** The object on the other end of the lookup, e.g. 'Account' (joined if polymorphic). */
  targetObject?: string;
}

/**
 * Columns added by Bulk / the loader that describe the RESULT, not the input.
 * `sf__*` are the v2 successfulResults markers; a bare `Id` is prepended by the
 * legacy v1 loader to report the record that was inserted/updated. None reflect
 * the uploaded dataset, so they are stripped before classification.
 */
const RESULT_COLUMNS = new Set(['Id', 'sf__Created', 'sf__Error', 'sf__Id', 'sf__Unprocessed']);

export function isResultColumn(header: string): boolean {
  return RESULT_COLUMNS.has(header.trim());
}

export function classifyUploadField(header: string): UploadField {
  const raw = header.trim();
  const dot = raw.indexOf('.');
  if (dot > 0) {
    const relationshipName = raw.slice(0, dot);
    const matchField = raw.slice(dot + 1);
    // Key order below is the documented JSON contract — keep it logical, not alphabetical.
    if (relationshipName.toLowerCase() === 'recordtype') {
      // Matched by Label (Name), not DeveloperName — DeveloperName is not indexed.
      // eslint-disable-next-line perfectionist/sort-objects
      return { raw, kind: 'recordType', relationshipName, matchField };
    }

    // eslint-disable-next-line perfectionist/sort-objects
    return { raw, kind: 'externalIdLookup', relationshipName, matchField };
  }

  // eslint-disable-next-line perfectionist/sort-objects
  return { raw, kind: 'direct' };
}

export function classifyUploadFields(headers: string[]): UploadField[] {
  return headers.filter((h) => !isResultColumn(h)).map((h) => classifyUploadField(h));
}

/** One human-readable annotation per field, used by command output. */
export function annotateUploadField(f: UploadField): string {
  switch (f.kind) {
    // RecordType matches by its Name (Label); external-id lookups match by the
    // named external-id field. Both read as "lookup → <relationship> by <field>".
    case 'externalIdLookup':
    case 'recordType': {
      return `lookup → ${f.relationshipName} by ${f.matchField}`;
    }

    // 'direct' fields carry no annotation.
    default: {
      return '';
    }
  }
}

/**
 * Render fields as plain display lines for terminal output — just the raw column
 * names. Structural classification lives in the JSON (uploadFieldsClassified).
 */
export function formatUploadFields(fields: UploadField[]): string[] {
  if (fields.length === 0) return ['  (no upload fields found — job may have no successful records)'];
  return fields.map((f) => `  ${f.raw}`);
}
