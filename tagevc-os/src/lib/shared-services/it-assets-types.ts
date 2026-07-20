/**
 * IT asset / software / licensing types — Phase 20 scaffolding.
 * Tables stubbed in supabase/phase20_it_assets.sql; app does not read them yet.
 */

export type ItAssetKind = 'laptop' | 'phone' | 'peripheral' | 'other_hardware';

export type ItAssetStatus =
  | 'in_stock'
  | 'assigned'
  | 'repair'
  | 'retired'
  | 'lost';

export type ItSoftwareLicenseStatus =
  | 'active'
  | 'pending'
  | 'expired'
  | 'cancelled';

export type ItHardwareAsset = {
  asset_id: string;
  kind: ItAssetKind;
  status: ItAssetStatus;
  /** Owning legal entity (subsidiary scope). */
  entity_id: string | null;
  /** Assigned profile user id when checked out. */
  assigned_user_id: string | null;
  serial_number: string | null;
  model: string | null;
  notes: string | null;
  purchased_at: string | null;
  /** Warranty end date (Phase 29). */
  warranty_ends_at: string | null;
  updated_at: string;
};

export type ItSoftwareLicense = {
  license_id: string;
  product_name: string;
  vendor: string | null;
  status: ItSoftwareLicenseStatus;
  seat_count: number | null;
  seats_used: number | null;
  entity_id: string | null;
  renewal_date: string | null;
  cost_k: number | null;
  notes: string | null;
  updated_at: string;
};

export type ItAssignmentEvent = {
  event_id: string;
  kind: 'assign' | 'return' | 'license_grant' | 'license_revoke';
  asset_id: string | null;
  license_id: string | null;
  user_id: string | null;
  entity_id: string | null;
  actor_id: string | null;
  note: string | null;
  created_at: string;
};
