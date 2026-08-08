/** Digital Business Card spine types. */

export type ShareableField = {
  label: string;
  value: string;
  share: boolean;
};

export type DigitalCardCta = {
  label: string;
  url: string;
};

export type DigitalCardTheme = {
  primary?: string;
  accent?: string;
  surface?: string;
  logo_url?: string;
};

export type DigitalCardSocials = {
  linkedin?: string;
  x?: string;
  instagram?: string;
  github?: string;
  other?: string;
};

export type SourceChannel =
  | 'linkedin'
  | 'email_sig'
  | 'nfc'
  | 'wallet'
  | 'in_app'
  | 'desk'
  | 'direct'
  | 'unknown'
  | `event_${string}`;

export const SOURCE_CHANNELS = [
  'linkedin',
  'email_sig',
  'nfc',
  'wallet',
  'in_app',
  'desk',
  'direct',
  'unknown',
] as const;

export type NetworkContactStatus =
  | 'new'
  | 'followed_up'
  | 'linked_lead'
  | 'linked_candidate'
  | 'closed';

export type DigitalCardEventType =
  | 'view'
  | 'save_vcard'
  | 'exchange_submit'
  | 'share_click'
  | 'revoke_hit'
  | 'wallet_apple'
  | 'wallet_google';

export type DigitalCardPersona = {
  id: string;
  user_profile_id: string;
  entity_id: string;
  public_id: string;
  public_slug: string | null;
  display_name: string;
  title: string;
  department: string;
  emails: ShareableField[];
  phones: ShareableField[];
  website: string | null;
  calendar_url: string | null;
  booking_url: string | null;
  socials: DigitalCardSocials;
  bio_short: string;
  photo_url: string | null;
  cta_primary: DigitalCardCta;
  theme: DigitalCardTheme;
  is_default: boolean;
  is_active: boolean;
  revoked_at: string | null;
  revoke_message: string | null;
  event_tag: string | null;
  event_tag_remaining: number | null;
  created_at: string;
  updated_at: string;
};

export type NetworkContact = {
  id: string;
  owner_user_id: string;
  entity_id: string;
  persona_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  source_channel: string;
  source_detail: string | null;
  entry_path: string | null;
  meeting_context: string | null;
  event_tag: string | null;
  location_text: string | null;
  their_notes: string | null;
  our_notes: string | null;
  consent_marketing: boolean;
  consent_at: string | null;
  external_submission_id: string | null;
  raw_payload: Record<string, unknown>;
  status: NetworkContactStatus;
  linked_client_lead_id: string | null;
  linked_candidate_id: string | null;
  routing_suggestion: RoutingSuggestion | null;
  created_at: string;
  updated_at: string;
};

export type RoutingSuggestion = {
  action:
    | 'network_contact'
    | 'client_lead'
    | 'candidate_interest'
    | 'sales_notify';
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  human_confirm: boolean;
};

export type EntityCardTemplate = {
  entity_id: string;
  default_cta: DigitalCardCta;
  locked_theme: DigitalCardTheme;
  required_share_fields: string[];
  routing_defaults: Record<string, unknown>;
  company_main_line: string | null;
  company_website: string | null;
  desk_public_id: string | null;
};

/** Public payload — shareable fields only. Never secrets/comp/credit. */
export type PublicCardPayload = {
  public_id: string;
  entity_id: string;
  company_name: string;
  display_name: string;
  title: string;
  department: string;
  bio_short: string;
  photo_url: string | null;
  emails: Array<{ label: string; value: string }>;
  phones: Array<{ label: string; value: string }>;
  website: string | null;
  calendar_url: string | null;
  booking_url: string | null;
  socials: DigitalCardSocials;
  cta_primary: DigitalCardCta | null;
  theme: DigitalCardTheme;
  logo_url: string | null;
  profile_url: string;
  revoked: boolean;
  revoke_message: string | null;
  company_main_line: string | null;
  company_website: string | null;
};

export type ExchangeSubmitInput = {
  public_id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  title?: string;
  note?: string;
  how_we_met?: string;
  consent_marketing?: boolean;
  /** Honeypot — must be empty */
  website?: string;
  source_channel?: string;
  source_detail?: string;
  entry_path?: string;
  external_submission_id?: string;
  intent?: 'hiring' | 'jobseek' | 'other' | '';
};
