/**
 * DocuSign merge-field autofill from OS records (employee / vendor / deal / client_org).
 */

export type AutofillRecordKind =
  | 'employee'
  | 'vendor'
  | 'deal'
  | 'client_org'
  | 'generic';

export type AutofillSourceRecord = {
  kind: AutofillRecordKind;
  entityId?: string | null;
  /** Flat fields from HRIS / AP / deal-flow / Signent client_org */
  fields: Record<string, string | number | null | undefined>;
};

/** Common DocuSign tab / merge labels → source keys */
export const AUTOFILL_ALIASES: Record<string, string[]> = {
  FullName: ['full_name', 'name', 'employee_name', 'contact_name'],
  FirstName: ['first_name', 'given_name'],
  LastName: ['last_name', 'family_name'],
  Email: ['email', 'work_email', 'primary_email'],
  Title: ['title', 'job_title'],
  Company: ['company', 'company_name', 'legal_name', 'vendor_name', 'org_name'],
  Address: ['address', 'street', 'address1'],
  City: ['city', 'hq_city'],
  State: ['state', 'hq_state', 'region'],
  PostalCode: ['postal_code', 'zip', 'hq_postal'],
  Phone: ['phone', 'mobile', 'work_phone'],
  EntityName: ['entity_name', 'entity_label'],
  TaxYear: ['tax_year'],
  StartDate: ['start_date', 'hire_date', 'effective_date'],
};

function pick(
  fields: Record<string, string | number | null | undefined>,
  keys: string[],
): string | null {
  for (const k of keys) {
    const v = fields[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  // case-insensitive
  const lower = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v]),
  );
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

export type AutofillResult = {
  tabs: Record<string, string>;
  missing: string[];
  kind: AutofillRecordKind;
};

export function buildAutofillTabs(
  record: AutofillSourceRecord,
  requestedLabels?: string[],
): AutofillResult {
  const labels = requestedLabels?.length
    ? requestedLabels
    : Object.keys(AUTOFILL_ALIASES);
  const tabs: Record<string, string> = {};
  const missing: string[] = [];

  for (const label of labels) {
    const aliases = AUTOFILL_ALIASES[label] ?? [label];
    const value = pick(record.fields, aliases);
    if (value) tabs[label] = value;
    else missing.push(label);
  }

  if (record.entityId && !tabs.EntityName) {
    const entityMap: Record<string, string> = {
      'ENT-FIRM': 'Tage Venture Capital',
      'ENT-R619': 'Recruit 619',
      'ENT-SIGNENT': 'Signent HR',
      'ENT-INDA': 'Instant NDA',
    };
    const name = entityMap[record.entityId];
    if (name) tabs.EntityName = name;
  }

  return { tabs, missing, kind: record.kind };
}

/** Convert autofill tabs to DocuSign textTabs shape for a signer. */
export function tabsToDocuSignTextTabs(
  tabs: Record<string, string>,
): Array<{ tabLabel: string; value: string }> {
  return Object.entries(tabs).map(([tabLabel, value]) => ({ tabLabel, value }));
}
