/** Map DB persona → public shareable payload (no secrets/comp/credit). */

import { entityDisplayName } from '@/lib/entities/display-name';
import { mergeTheme, defaultCtaForEntity, companyWebsiteForEntity } from './theme';
import { publicCardUrl } from './urls';
import type {
  DigitalCardPersona,
  EntityCardTemplate,
  PublicCardPayload,
  ShareableField,
} from './types';

function sharedOnly(
  fields: ShareableField[] | null | undefined,
): Array<{ label: string; value: string }> {
  if (!Array.isArray(fields)) return [];
  return fields
    .filter((f) => f && f.share !== false && String(f.value || '').trim())
    .map((f) => ({
      label: String(f.label || 'Contact').trim(),
      value: String(f.value).trim(),
    }));
}

export function toPublicCardPayload(
  persona: DigitalCardPersona,
  template?: EntityCardTemplate | null,
  opts?: { src?: string | null },
): PublicCardPayload {
  const revoked = Boolean(persona.revoked_at) || !persona.is_active;
  const company = entityDisplayName(persona.entity_id);
  const theme = mergeTheme(
    persona.entity_id,
    template?.locked_theme,
    persona.theme,
  );
  const cta =
    persona.cta_primary?.label && persona.cta_primary?.url
      ? persona.cta_primary
      : template?.default_cta?.label
        ? template.default_cta
        : defaultCtaForEntity(persona.entity_id);

  if (revoked) {
    return {
      public_id: persona.public_id,
      entity_id: persona.entity_id,
      company_name: company,
      display_name: '',
      title: '',
      department: '',
      bio_short: '',
      photo_url: null,
      emails: [],
      phones: [],
      website: null,
      calendar_url: null,
      booking_url: null,
      socials: {},
      cta_primary: template?.company_website
        ? { label: `Contact ${company}`, url: template.company_website }
        : {
            label: `Visit ${company}`,
            url: companyWebsiteForEntity(persona.entity_id),
          },
      theme,
      logo_url: theme.logo_url ?? null,
      profile_url: publicCardUrl(persona.public_id, { src: opts?.src }),
      revoked: true,
      revoke_message:
        persona.revoke_message?.trim() ||
        `No longer with ${company}`,
      company_main_line: template?.company_main_line ?? null,
      company_website:
        template?.company_website ?? companyWebsiteForEntity(persona.entity_id),
    };
  }

  return {
    public_id: persona.public_id,
    entity_id: persona.entity_id,
    company_name: company,
    display_name: persona.display_name,
    title: persona.title,
    department: persona.department,
    bio_short: persona.bio_short,
    photo_url: persona.photo_url,
    emails: sharedOnly(persona.emails),
    phones: sharedOnly(persona.phones),
    website: persona.website,
    calendar_url: persona.calendar_url,
    booking_url: persona.booking_url,
    socials: persona.socials || {},
    cta_primary: cta,
    theme,
    logo_url: theme.logo_url ?? null,
    profile_url: publicCardUrl(persona.public_id, { src: opts?.src }),
    revoked: false,
    revoke_message: null,
    company_main_line: template?.company_main_line ?? null,
    company_website:
      template?.company_website ?? companyWebsiteForEntity(persona.entity_id),
  };
}
