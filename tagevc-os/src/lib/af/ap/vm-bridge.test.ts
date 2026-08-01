import { describe, expect, it } from 'vitest';
import {
  buildVmAfVendorLinks,
  mapVmVendorToAfSuggestion,
} from '@/lib/af/ap/vm-bridge';
import type { VmVendor } from '@/lib/vendor-mgmt/types';

const sample: VmVendor = {
  id: 'V-TEST',
  name: 'Acme SaaS',
  entity_id: 'ENT-R619',
  category: 'SaaS',
  product: 'Seats',
  pricing_model: 'Per User',
  billing_cadence: 'Monthly',
  invoice_amount: 1200,
  currency: 'USD',
  seats_contracted: 10,
  seats_active: 8,
  unit_price: 12,
  contract_start: null,
  contract_end: null,
  auto_renew: true,
  status: 'Active',
  owner: null,
  notes: null,
  partner_key: null,
  cost_center_id: null,
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('af vm bridge', () => {
  it('maps entity codes and ids', () => {
    const af = mapVmVendorToAfSuggestion(sample);
    expect(af.id).toBe('VM-V-TEST');
    expect(af.entityCode).toBe('R619');
    expect(af.taxStatus).toBe('w9_missing');
  });

  it('builds portal links', () => {
    const links = buildVmAfVendorLinks([sample]);
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toContain('/vendor-management/vendors/V-TEST');
  });
});
