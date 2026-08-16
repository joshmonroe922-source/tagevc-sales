import { describe, expect, it } from 'vitest';
import {
  orderedLogoBarIds,
  PARENT_ENTITY_ID,
  signatureLogoBar,
} from '@/lib/brand/email-signatures/portfolio';
import {
  renderEmailSignatureFragment,
  renderEmailSignatureHtml,
} from '@/lib/brand/email-signatures/render';
import { isEmailSignatureStep } from '@/lib/hris/email-signature-step';

describe('email signature portfolio bar', () => {
  it('parent bar lists Tage then all subsidiaries', () => {
    const ids = orderedLogoBarIds('ENT-FIRM');
    expect(ids[0]).toBe(PARENT_ENTITY_ID);
    expect(ids).toEqual([
      'ENT-FIRM',
      'ENT-R619',
      'ENT-SIGNENT',
      'ENT-INDA',
    ]);
  });

  it('subsidiary bar puts employer first then parent then sisters', () => {
    const ids = orderedLogoBarIds('ENT-R619');
    expect(ids[0]).toBe('ENT-R619');
    expect(ids[1]).toBe('ENT-FIRM');
    expect(ids).toContain('ENT-SIGNENT');
    expect(ids).toContain('ENT-INDA');
  });

  it('each logo has a clickable site URL', () => {
    const bar = signatureLogoBar('ENT-FIRM');
    expect(bar.length).toBe(4);
    for (const link of bar) {
      expect(link.href).toMatch(/^https?:\/\//);
      expect(link.logoUrl).toContain('brand-assets/marketing-sot');
    }
  });

  it('renders Josh parent signature with portfolio links', () => {
    const html = renderEmailSignatureHtml({
      fullName: 'Josh Monroe',
      jobTitle: 'Founder / CEO',
      email: 'joshmonroe@tagevc.com',
      entityId: 'ENT-FIRM',
      companyLine: 'Tage VC',
    });
    expect(html).toContain('Josh Monroe');
    expect(html).toContain('Founder / CEO');
    expect(html).toContain('Our companies');
    expect(html).toContain('tagevc.com');
    expect(html).toContain('recruit619.com');
    expect(html).toContain('signenthr.com');
    expect(html).toContain('instantnda.us');
    expect(renderEmailSignatureFragment({
      fullName: 'Josh Monroe',
      jobTitle: 'Founder / CEO',
      email: 'joshmonroe@tagevc.com',
      entityId: 'ENT-FIRM',
    })).not.toContain('<!DOCTYPE');
  });

  it('matches HRIS onboarding step key / hook', () => {
    expect(
      isEmailSignatureStep({
        step_key: 'sd.email_sig',
        system_hook: 'manual',
      }),
    ).toBe(true);
    expect(
      isEmailSignatureStep({
        step_key: 'other',
        system_hook: 'email_signature',
      }),
    ).toBe(true);
  });

  it('renders Lauren parent portfolio signature', () => {
    const html = renderEmailSignatureHtml({
      fullName: 'Lauren Monroe',
      jobTitle: 'Principal Strategist',
      email: 'laurenmonroe@tagevc.com',
      entityId: 'ENT-FIRM',
      companyLine: 'Tage VC',
    });
    expect(html).toContain('Lauren Monroe');
    expect(html).toContain('Principal Strategist');
    expect(html).toContain('laurenmonroe@tagevc.com');
    expect(html).toContain('tagevc.com');
    expect(html).toContain('recruit619.com');
  });
});