import { describe, expect, it } from 'vitest';
import {
  buildInstantNdaAccessCopy,
  buildInstantNdaEmail,
  INSTANT_NDA_APP_URL,
} from '@/lib/hris/instant-nda-access';

describe('buildInstantNdaAccessCopy', () => {
  it('names the hiring entity, not Tage, for a subsidiary hire', () => {
    const copy = buildInstantNdaAccessCopy({
      entity_id: 'ENT-R619',
      upn: 'dennismccall@recruit619.com',
    });
    expect(copy.lines[0]).toContain('Recruit 619');
    expect(copy.lines[0]).not.toContain('Tage');
    expect(copy.lines[0]).not.toContain('ENT-R619');
  });

  it('credits the access to the hire’s own email domain', () => {
    const copy = buildInstantNdaAccessCopy({
      entity_id: 'ENT-SIGNENT',
      upn: 'someone@signenthr.com',
    });
    expect(copy.lines[0]).toContain('@signenthr.com');
    expect(copy.lines[0]).toContain('Signent HR');
  });

  it('falls back to generic wording with no UPN', () => {
    const copy = buildInstantNdaAccessCopy({ entity_id: 'ENT-FIRM' });
    expect(copy.lines[0]).toContain('your work email');
  });

  it('reframes for Instant NDA staff — it is their own product', () => {
    const copy = buildInstantNdaAccessCopy({
      entity_id: 'ENT-INDA',
      upn: 'someone@instantnda.us',
    });
    expect(copy.lines[0]).toContain('the product you are joining');
    expect(copy.lines[0]).not.toContain('at no cost to you');
  });

  it('treats the legacy Instant NDA code the same way', () => {
    expect(buildInstantNdaAccessCopy({ entity_id: 'ENT-002' }).lines[0]).toEqual(
      buildInstantNdaAccessCopy({ entity_id: 'ENT-INDA' }).lines[0],
    );
  });

  it('points at the web app and asks for use on sensitive conversations', () => {
    const copy = buildInstantNdaAccessCopy({ entity_id: 'ENT-R619' });
    expect(copy.lines.join(' ')).toContain(INSTANT_NDA_APP_URL);
    expect(copy.lines.join(' ')).toContain('native mobile apps are not live');
    expect(copy.lines.join(' ')).toContain('sensitive conversation');
  });
});

describe('buildInstantNdaEmail', () => {
  it('addresses the hire by first name and names their company', () => {
    const mail = buildInstantNdaEmail({
      full_name: 'Dennis McCall',
      entity_id: 'ENT-R619',
      upn: 'dennismccall@recruit619.com',
    });
    expect(mail.subject).toBe('Your free Instant NDA enterprise access at Recruit 619');
    expect(mail.text.startsWith('Hi Dennis,')).toBe(true);
  });

  it('links the app in HTML and never leaks an ENT- code', () => {
    const mail = buildInstantNdaEmail({
      full_name: 'Dennis McCall',
      entity_id: 'ENT-R619',
      upn: 'dennismccall@recruit619.com',
    });
    expect(mail.html).toContain(`href="${INSTANT_NDA_APP_URL}"`);
    expect(mail.html).not.toContain('ENT-R619');
  });

  it('escapes HTML in the name', () => {
    const mail = buildInstantNdaEmail({
      full_name: '<script>x</script>',
      entity_id: 'ENT-R619',
    });
    expect(mail.html).not.toContain('<script>');
  });
});
