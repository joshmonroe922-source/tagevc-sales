import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { entityDisplayName } from '@/lib/entities/display-name';
import { toPublicCardPayload } from './public-payload';
import { buildVCard } from './vcard';
import {
  parseSourceChannel,
  publicCardUrl,
  taggedCardUrl,
  appHostCardPathsEnabled,
} from './urls';
import { suggestRouting, buildDedupeSuggestions } from './routing';
import { buildExchangeIdempotencyKey } from './exchange';
import { generatePublicId } from './public-id';
import type { DigitalCardPersona } from './types';

const SQL = readFileSync(
  join(process.cwd(), 'supabase/phase98_digital_cards.sql'),
  'utf8',
);

function samplePersona(
  overrides: Partial<DigitalCardPersona> = {},
): DigitalCardPersona {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    user_profile_id: '22222222-2222-2222-2222-222222222222',
    entity_id: 'ENT-R619',
    public_id: 'abcXYZ123456',
    public_slug: null,
    display_name: 'Dennis Recruiter',
    title: 'VP Recruiting',
    department: 'Talent',
    emails: [{ label: 'Work', value: 'dennis@recruit619.com', share: true }],
    phones: [{ label: 'Mobile', value: '619-555-0100', share: true }],
    website: null,
    calendar_url: null,
    booking_url: null,
    socials: { linkedin: 'https://linkedin.com/in/dennis' },
    bio_short: 'Helping teams hire well.',
    photo_url: null,
    cta_primary: {
      label: 'Request talent / Find work',
      url: 'https://recruit619.com',
    },
    theme: {},
    is_default: true,
    is_active: true,
    revoked_at: null,
    revoke_message: null,
    event_tag: null,
    event_tag_remaining: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('phase98 digital cards sql safety', () => {
  it('is additive and does not drop os_store_snapshots', () => {
    assert.doesNotMatch(SQL, /drop\s+table\s+.*os_store_snapshots/i);
    assert.match(SQL, /os_digital_card_personas/);
    assert.match(SQL, /os_network_contacts/);
    assert.match(SQL, /os_digital_card_events/);
    assert.match(SQL, /os_digital_card_entity_templates/);
    assert.match(SQL, /digital_card_activate/);
    assert.match(SQL, /digital_card_revoke/);
  });

  it('keeps public/anon away from tables', () => {
    assert.match(SQL, /revoke all on public\.os_digital_card_personas from public, anon/i);
    assert.match(SQL, /revoke all on public\.os_network_contacts from public, anon/i);
  });
});

describe('public payload + display names', () => {
  it('never surfaces ENT-* as company label', () => {
    const card = toPublicCardPayload(samplePersona());
    assert.equal(card.company_name, 'Recruit 619');
    assert.doesNotMatch(card.company_name, /^ENT-/);
    assert.equal(entityDisplayName('ENT-FIRM'), 'Tage Venture Capital');
  });

  it('title edit keeps same public_id (case 1)', () => {
    const before = samplePersona({ title: 'Recruiter' });
    const after = samplePersona({ title: 'VP Recruiting' });
    assert.equal(before.public_id, after.public_id);
    const pub = toPublicCardPayload(after);
    assert.equal(pub.title, 'VP Recruiting');
    assert.equal(pub.public_id, 'abcXYZ123456');
  });

  it('revoked payload is safe fallback only (case 5)', () => {
    const card = toPublicCardPayload(
      samplePersona({
        revoked_at: new Date().toISOString(),
        is_active: false,
        revoke_message: 'No longer with Recruit 619',
      }),
    );
    assert.equal(card.revoked, true);
    assert.equal(card.emails.length, 0);
    assert.equal(card.phones.length, 0);
    assert.equal(card.display_name, '');
    assert.match(card.revoke_message || '', /No longer with Recruit 619/);
    assert.ok(card.cta_primary?.url);
  });

  it('omits non-shareable contact fields', () => {
    const card = toPublicCardPayload(
      samplePersona({
        emails: [
          { label: 'Work', value: 'a@x.com', share: true },
          { label: 'Personal', value: 'secret@x.com', share: false },
        ],
      }),
    );
    assert.deepEqual(
      card.emails.map((e) => e.value),
      ['a@x.com'],
    );
  });
});

describe('QR / tagged URLs (cases 2–3)', () => {
  it('scan and tap encode the same tagged profile URL', () => {
    const url = taggedCardUrl('abcXYZ123456', 'linkedin');
    assert.match(url, /abcXYZ123456/);
    assert.match(url, /src=linkedin/);
    // Tappable QR uses this same URL as href
    assert.equal(url, publicCardUrl('abcXYZ123456', { src: 'linkedin' }));
  });

  it('path alias and ?src resolve to source_channel', () => {
    assert.equal(parseSourceChannel(null, 'linkedin'), 'linkedin');
    assert.equal(parseSourceChannel('email_sig'), 'email_sig');
    assert.equal(parseSourceChannel('event-summit'), 'event_summit');
    assert.equal(parseSourceChannel(null), 'direct');
  });

  it('app-host path is available when subdomain not ready', () => {
    // Default without DIGITAL_CARD_HOST_READY
    assert.equal(typeof appHostCardPathsEnabled(), 'boolean');
    const url = publicCardUrl('abcXYZ123456', { src: 'desk' });
    assert.match(url, /\/p\/abcXYZ123456/);
  });
});

describe('exchange + routing (cases 4, 6, 8)', () => {
  it('idempotency key is stable for same day contact', () => {
    const a = buildExchangeIdempotencyKey({
      publicId: 'abc',
      email: 'x@y.com',
      phone: '619',
    });
    const b = buildExchangeIdempotencyKey({
      publicId: 'abc',
      email: 'x@y.com',
      phone: '619',
    });
    assert.equal(a, b);
  });

  it('client external_submission_id wins for idempotency', () => {
    const key = buildExchangeIdempotencyKey({
      publicId: 'abc',
      clientKey: 'sub-123',
    });
    assert.equal(key, 'sub-123');
  });

  it('Recruit hiring → client_lead with human confirm', () => {
    const s = suggestRouting({
      entityId: 'ENT-R619',
      intent: 'hiring',
    });
    assert.equal(s.action, 'client_lead');
    assert.equal(s.human_confirm, true);
  });

  it('Recruit jobseek → candidate_interest with human confirm', () => {
    const s = suggestRouting({
      entityId: 'ENT-R619',
      intent: 'jobseek',
    });
    assert.equal(s.action, 'candidate_interest');
    assert.equal(s.human_confirm, true);
  });

  it('dedupe suggests link — never silent destructive', () => {
    const d = buildDedupeSuggestions({
      email: 'a@b.com',
      existingContacts: [{ id: 'c1', email: 'a@b.com' }],
    });
    assert.equal(d.length, 1);
    assert.match(d[0]!.message, /human confirms/i);
  });
});

describe('vcard + public_id', () => {
  it('builds vcard without ENT-* org codes', () => {
    const card = toPublicCardPayload(samplePersona());
    const vcf = buildVCard(card);
    assert.match(vcf, /BEGIN:VCARD/);
    assert.match(vcf, /ORG:Recruit 619/);
    assert.doesNotMatch(vcf, /ENT-R619/);
  });

  it('public_id generator is opaque and stable-length', () => {
    const id = generatePublicId();
    assert.match(id, /^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('careers / intake pipelines untouched (case 9)', () => {
  it('website intake module still present', () => {
    const intake = readFileSync(
      join(process.cwd(), 'src/lib/deal-flow/website-intake.ts'),
      'utf8',
    );
    assert.match(intake, /ingestWebsiteLead/);
    assert.doesNotMatch(SQL, /drop\s+table\s+.*os_website_intake/i);
  });
});
