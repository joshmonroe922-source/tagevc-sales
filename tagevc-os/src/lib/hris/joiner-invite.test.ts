import { afterEach, describe, expect, it } from 'vitest';
import {
  buildJoinerInviteBody,
  joinerInviteEnabled,
  maskEmail,
  sendJoinerInvite,
} from '@/lib/hris/joiner-invite';

const base = {
  full_name: 'Dennis McCall',
  personal_email: 'bdennismccall@gmail.com',
  entity_id: 'ENT-R619',
  role_title: 'VP of Recruiting',
  start_date: '2026-08-10',
  upn: 'dennismccall@recruit619.com',
};

afterEach(() => {
  delete process.env.HRIS_JOINER_INVITE_EMAIL;
});

describe('joinerInviteEnabled', () => {
  it('defaults on so every new hire gets their own credentials', () => {
    expect(joinerInviteEnabled()).toBe(true);
  });

  it.each(['0', 'false', 'off'])('is disabled by %s', (value) => {
    process.env.HRIS_JOINER_INVITE_EMAIL = value;
    expect(joinerInviteEnabled()).toBe(false);
  });
});

describe('buildJoinerInviteBody', () => {
  it('uses the entity display name, never the ENT- code', () => {
    const { subject, html, text } = buildJoinerInviteBody({
      ...base,
      temp_password: 'Tmp!abc123A1',
    });
    expect(subject).toContain('Recruit 619');
    expect(subject).not.toContain('ENT-R619');
    expect(html).not.toContain('ENT-R619');
    expect(text).not.toContain('ENT-R619');
  });

  it('includes the UPN and temp password when the account was just created', () => {
    const { text } = buildJoinerInviteBody({
      ...base,
      temp_password: 'Tmp!abc123A1',
    });
    expect(text).toContain('dennismccall@recruit619.com');
    expect(text).toContain('Tmp!abc123A1');
    expect(text).toContain('set your own password');
  });

  it('falls back to self-service reset when no temp password is available', () => {
    const { text } = buildJoinerInviteBody({ ...base, temp_password: null });
    expect(text).toContain('passwordreset.microsoftonline.com');
    expect(text).not.toContain('Temporary password');
  });

  it('sends an R619 hire to the Recruit 619 OS, never the Tage parent OS', () => {
    const { text } = buildJoinerInviteBody(base);
    expect(text).toContain('Recruit 619 OS');
    expect(text).toContain('portal.recruit619.com');
    expect(text).not.toContain('app.tagevc.com');
  });

  it.each([
    ['ENT-SIGNENT', 'portal.signenthr.com', 'Signent HR OS'],
    ['ENT-INDA', 'portal.instantnda.us', 'Instant NDA OS'],
    ['ENT-FIRM', 'app.tagevc.com', 'Tage Venture Capital OS'],
  ])('routes %s hires to %s', (entityId, host, label) => {
    const { text } = buildJoinerInviteBody({ ...base, entity_id: entityId });
    expect(text).toContain(host);
    expect(text).toContain(label);
  });

  it('falls back to an entity-scoped page for an unregistered entity', () => {
    const { text } = buildJoinerInviteBody({ ...base, entity_id: 'ENT-NEWCO' });
    expect(text).toContain('/entities/ENT-NEWCO');
  });

  it('includes Instant NDA enterprise access without hijacking the OS link', () => {
    const { text } = buildJoinerInviteBody(base);
    expect(text).toContain('Instant NDA');
    expect(text).toContain('app.instantnda.us');
    // The entity OS link must survive alongside the new section.
    expect(text).toContain('portal.recruit619.com');
    expect(text).not.toContain('app.tagevc.com');
  });

  it('greets by first name only', () => {
    const { text } = buildJoinerInviteBody(base);
    expect(text.startsWith('Hi Dennis,')).toBe(true);
  });

  it('escapes HTML in employee-supplied fields', () => {
    const { html } = buildJoinerInviteBody({
      ...base,
      full_name: '<script>alert(1)</script> McCall',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('sendJoinerInvite', () => {
  it('does not send when disabled', async () => {
    process.env.HRIS_JOINER_INVITE_EMAIL = '0';
    const res = await sendJoinerInvite({ ...base, temp_password: 'x' });
    expect(res.sent).toBe(false);
    expect(res.detail).toContain('disabled');
  });

  it('reports a clear reason when no personal email is on file', async () => {
    const res = await sendJoinerInvite({ ...base, personal_email: '   ' });
    expect(res.sent).toBe(false);
    expect(res.detail).toContain('No personal email on file');
  });

  it('rejects a malformed personal email instead of attempting a send', async () => {
    const res = await sendJoinerInvite({ ...base, personal_email: 'not-an-email' });
    expect(res.sent).toBe(false);
    expect(res.detail).toContain('not a valid address');
  });

  it('requires a UPN', async () => {
    const res = await sendJoinerInvite({ ...base, upn: '' });
    expect(res.sent).toBe(false);
    expect(res.detail).toContain('No UPN');
  });
});

describe('maskEmail', () => {
  it('keeps the domain but hides the local part', () => {
    expect(maskEmail('bdennismccall@gmail.com')).toBe('b************@gmail.com');
  });
});
