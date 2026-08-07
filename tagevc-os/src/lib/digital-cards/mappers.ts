import type {
  DigitalCardCta,
  DigitalCardPersona,
  DigitalCardSocials,
  DigitalCardTheme,
  EntityCardTemplate,
  NetworkContact,
  RoutingSuggestion,
  ShareableField,
} from './types';

function asJsonArray(v: unknown): ShareableField[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      return {
        label: String(o.label ?? ''),
        value: String(o.value ?? ''),
        share: o.share !== false,
      };
    })
    .filter(Boolean) as ShareableField[];
}

function asCta(v: unknown): DigitalCardCta {
  if (!v || typeof v !== 'object') return { label: '', url: '' };
  const o = v as Record<string, unknown>;
  return {
    label: String(o.label ?? ''),
    url: String(o.url ?? ''),
  };
}

function asTheme(v: unknown): DigitalCardTheme {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  return {
    primary: o.primary ? String(o.primary) : undefined,
    accent: o.accent ? String(o.accent) : undefined,
    surface: o.surface ? String(o.surface) : undefined,
    logo_url: o.logo_url ? String(o.logo_url) : undefined,
  };
}

function asSocials(v: unknown): DigitalCardSocials {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  return {
    linkedin: o.linkedin ? String(o.linkedin) : undefined,
    x: o.x ? String(o.x) : undefined,
    instagram: o.instagram ? String(o.instagram) : undefined,
    github: o.github ? String(o.github) : undefined,
    other: o.other ? String(o.other) : undefined,
  };
}

export function mapPersona(row: Record<string, unknown>): DigitalCardPersona {
  return {
    id: String(row.id),
    user_profile_id: String(row.user_profile_id),
    entity_id: String(row.entity_id),
    public_id: String(row.public_id),
    public_slug: row.public_slug ? String(row.public_slug) : null,
    display_name: String(row.display_name ?? ''),
    title: String(row.title ?? ''),
    department: String(row.department ?? ''),
    emails: asJsonArray(row.emails),
    phones: asJsonArray(row.phones),
    website: row.website ? String(row.website) : null,
    calendar_url: row.calendar_url ? String(row.calendar_url) : null,
    booking_url: row.booking_url ? String(row.booking_url) : null,
    socials: asSocials(row.socials),
    bio_short: String(row.bio_short ?? ''),
    photo_url: row.photo_url ? String(row.photo_url) : null,
    cta_primary: asCta(row.cta_primary),
    theme: asTheme(row.theme),
    is_default: Boolean(row.is_default),
    is_active: row.is_active !== false,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    revoke_message: row.revoke_message ? String(row.revoke_message) : null,
    event_tag: row.event_tag ? String(row.event_tag) : null,
    event_tag_remaining:
      row.event_tag_remaining != null
        ? Number(row.event_tag_remaining)
        : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

export function mapTemplate(row: Record<string, unknown>): EntityCardTemplate {
  return {
    entity_id: String(row.entity_id),
    default_cta: asCta(row.default_cta),
    locked_theme: asTheme(row.locked_theme),
    required_share_fields: Array.isArray(row.required_share_fields)
      ? row.required_share_fields.map(String)
      : [],
    routing_defaults:
      row.routing_defaults && typeof row.routing_defaults === 'object'
        ? (row.routing_defaults as Record<string, unknown>)
        : {},
    company_main_line: row.company_main_line
      ? String(row.company_main_line)
      : null,
    company_website: row.company_website ? String(row.company_website) : null,
    desk_public_id: row.desk_public_id ? String(row.desk_public_id) : null,
  };
}

export function mapContact(row: Record<string, unknown>): NetworkContact {
  return {
    id: String(row.id),
    owner_user_id: String(row.owner_user_id),
    entity_id: String(row.entity_id),
    persona_id: row.persona_id ? String(row.persona_id) : null,
    name: String(row.name ?? ''),
    email: row.email ? String(row.email) : null,
    phone: row.phone ? String(row.phone) : null,
    company: row.company ? String(row.company) : null,
    title: row.title ? String(row.title) : null,
    source_channel: String(row.source_channel ?? 'unknown'),
    source_detail: row.source_detail ? String(row.source_detail) : null,
    entry_path: row.entry_path ? String(row.entry_path) : null,
    meeting_context: row.meeting_context ? String(row.meeting_context) : null,
    event_tag: row.event_tag ? String(row.event_tag) : null,
    location_text: row.location_text ? String(row.location_text) : null,
    their_notes: row.their_notes ? String(row.their_notes) : null,
    our_notes: row.our_notes ? String(row.our_notes) : null,
    consent_marketing: Boolean(row.consent_marketing),
    consent_at: row.consent_at ? String(row.consent_at) : null,
    external_submission_id: row.external_submission_id
      ? String(row.external_submission_id)
      : null,
    raw_payload:
      row.raw_payload && typeof row.raw_payload === 'object'
        ? (row.raw_payload as Record<string, unknown>)
        : {},
    status: (row.status as NetworkContact['status']) || 'new',
    linked_client_lead_id: row.linked_client_lead_id
      ? String(row.linked_client_lead_id)
      : null,
    linked_candidate_id: row.linked_candidate_id
      ? String(row.linked_candidate_id)
      : null,
    routing_suggestion:
      row.routing_suggestion && typeof row.routing_suggestion === 'object'
        ? (row.routing_suggestion as RoutingSuggestion)
        : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}
