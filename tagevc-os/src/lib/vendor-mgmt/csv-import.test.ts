import { describe, expect, it } from 'vitest';
import {
  parseCsv,
  validateCsvHeaders,
  boolish,
} from '@/lib/vendor-mgmt/csv-import';

describe('vm csv import', () => {
  it('parses quoted commas', () => {
    const { headers, rows } = parseCsv(
      'vendor_id,name,entity_id\nV1,"Acme, Inc",ENT-FIRM\n',
    );
    expect(headers).toEqual(['vendor_id', 'name', 'entity_id']);
    expect(rows[0]?.name).toBe('Acme, Inc');
  });

  it('validates minimum vendor headers', () => {
    expect(validateCsvHeaders('vendors', ['vendor_id', 'name', 'entity_id']).ok).toBe(
      true,
    );
    expect(validateCsvHeaders('vendors', ['name']).ok).toBe(false);
  });

  it('boolish', () => {
    expect(boolish('true')).toBe(true);
    expect(boolish('0')).toBe(false);
  });
});
