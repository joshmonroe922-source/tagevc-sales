/**
 * Hosted logo URLs for email signatures (Outlook requires absolute https URLs).
 * Deployed from portal.tagevc.com/public/signatures/
 */
export const SIGNATURE_LOGO_BASE =
  typeof window !== 'undefined' && window.location.origin.includes('localhost')
    ? `${window.location.origin}/signatures`
    : 'https://portal.tagevc.com/signatures';

export const SIGNATURE_LOGOS = {
  tageVc: `${SIGNATURE_LOGO_BASE}/tage-vc.png`,
  recruit619: `${SIGNATURE_LOGO_BASE}/recruit619.png`,
  signentHr: `${SIGNATURE_LOGO_BASE}/signent-hr.png`,
  instantNda: `${SIGNATURE_LOGO_BASE}/instantnda.png`,
} as const;

export const JOSH_LINKEDIN_URL = 'https://www.linkedin.com/in/joshmonroe-tageventurecapital';

export type SignatureTemplate = {
  id: string;
  name: string;
  description: string;
  bodyHtml: string;
};

/** Build the Josh Monroe 4-company signature HTML (Outlook-safe table layout). */
export function buildJoshMonroeFourCompanySignature(
  logoBase = SIGNATURE_LOGO_BASE,
): string {
  const logos = {
    tageVc: `${logoBase}/tage-vc.png`,
    recruit619: `${logoBase}/recruit619.png`,
    signentHr: `${logoBase}/signent-hr.png`,
    instantNda: `${logoBase}/instantnda.png`,
  };

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:'Open Sans',Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#1e293b;max-width:520px;">
  <tr>
    <td style="padding:0 0 10px 0;">
      <span style="font-size:16px;font-weight:700;color:#1a3a4a;">Josh Monroe</span><br>
      <span style="font-size:13px;color:#475569;">Owner / CEO</span>
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 12px 0;">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:0 10px 0 0;vertical-align:middle;">
            <a href="https://tagevc.com" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
              <img src="${logos.tageVc}" alt="Tage Venture Capital" width="56" height="56" style="display:block;border:0;outline:none;width:56px;height:56px;" />
            </a>
          </td>
          <td style="padding:0 10px 0 0;vertical-align:middle;">
            <a href="https://recruit619.com" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
              <img src="${logos.recruit619}" alt="Recruit 619" width="56" height="56" style="display:block;border:0;outline:none;width:56px;height:56px;" />
            </a>
          </td>
          <td style="padding:0 10px 0 0;vertical-align:middle;">
            <a href="https://signenthr.com" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
              <img src="${logos.signentHr}" alt="Signent HR" width="56" height="56" style="display:block;border:0;outline:none;width:56px;height:56px;" />
            </a>
          </td>
          <td style="padding:0;vertical-align:middle;">
            <a href="https://instantnda.us" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">
              <img src="${logos.instantNda}" alt="Instant NDA" width="56" height="56" style="display:block;border:0;outline:none;width:56px;height:56px;" />
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 4px 0;font-size:13px;color:#334155;">
      D: <a href="tel:+16194859977" style="color:#334155;text-decoration:none;">619-485-9977</a><br>
      M: <a href="tel:+13177272932" style="color:#334155;text-decoration:none;">317-727-2932</a>
    </td>
  </tr>
  <tr>
    <td style="padding:4px 0 0 0;">
      <a href="${JOSH_LINKEDIN_URL}" target="_blank" rel="noopener noreferrer" style="color:#1a3a4a;font-size:13px;font-weight:600;text-decoration:none;">Connect on LinkedIn</a>
    </td>
  </tr>
</table>`;
}

export const JOSH_MONROE_FOUR_COMPANY_TEMPLATE: SignatureTemplate = {
  id: 'josh-monroe-4-company',
  name: 'Josh Monroe — 4 Company',
  description:
    'Four linked company logos (Tage VC, Recruit 619, Signent HR, Instant NDA) with contact details.',
  bodyHtml: buildJoshMonroeFourCompanySignature(),
};

export const SIGNATURE_TEMPLATES: SignatureTemplate[] = [
  JOSH_MONROE_FOUR_COMPANY_TEMPLATE,
];

export function getSignatureTemplate(id: string): SignatureTemplate | undefined {
  return SIGNATURE_TEMPLATES.find((t) => t.id === id);
}
