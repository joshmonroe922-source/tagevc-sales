/**
 * Google Wallet "Save" JWT for digital business cards (Generic pass).
 */

import { createSign } from 'node:crypto';
import type { PublicCardPayload } from '@/lib/digital-cards/types';
import { taggedCardUrl } from '@/lib/digital-cards/urls';
import { TAGE_NAVY } from '@/lib/digital-cards/theme';
import { getGoogleWalletConfig } from './config';

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwtRs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKeyPem: string,
): string {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${data}.${b64url(sig)}`;
}

export function googleWalletReady(): boolean {
  return getGoogleWalletConfig() !== null;
}

export function buildGoogleWalletSaveUrl(
  card: PublicCardPayload,
): { ok: true; url: string } | { ok: false; error: string; status: number } {
  const cfg = getGoogleWalletConfig();
  if (!cfg) {
    return {
      ok: false,
      error: 'Google Wallet is not configured',
      status: 503,
    };
  }
  if (card.revoked) {
    return { ok: false, error: 'Card revoked', status: 410 };
  }

  const walletUrl = taggedCardUrl(card.public_id, 'wallet');
  const classId = `${cfg.issuerId}.${cfg.classSuffix}`;
  const objectId = `${cfg.issuerId}.card_${card.public_id.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  const bg = (card.theme.primary || TAGE_NAVY).replace('#', '');
  const hexBackgroundColor = bg.length === 6 ? `#${bg}` : TAGE_NAVY;

  const text = (value: string) => ({
    defaultValue: { language: 'en-US', value },
  });

  const genericClass = {
    id: classId,
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['title']" }],
                },
              },
              endItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['company']" }],
                },
              },
            },
          },
        ],
      },
    },
  };

  const textModulesData = [
    { id: 'title', header: 'Title', body: card.title || '—' },
    { id: 'company', header: 'Company', body: card.company_name },
  ];
  if (card.emails[0]?.value) {
    textModulesData.push({
      id: 'email',
      header: 'Email',
      body: card.emails[0].value,
    });
  }
  if (card.phones[0]?.value) {
    textModulesData.push({
      id: 'phone',
      header: 'Phone',
      body: card.phones[0].value,
    });
  }

  const genericObject = {
    id: objectId,
    classId,
    state: 'ACTIVE',
    hexBackgroundColor,
    cardTitle: text(card.company_name),
    header: text(card.display_name),
    subheader: text(card.title || card.company_name),
    barcode: {
      type: 'QR_CODE',
      value: walletUrl,
      alternateText: 'Open live card',
    },
    textModulesData,
    linksModuleData: {
      uris: [
        {
          uri: walletUrl,
          description: 'Open live card',
          id: 'card',
        },
      ],
    },
  };

  const origins = [
    'https://card.tagevc.com',
    'https://app.tagevc.com',
    'http://localhost:3000',
  ];
  const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  if (app && !origins.includes(app)) origins.push(app);

  try {
    const token = signJwtRs256(
      { alg: 'RS256', typ: 'JWT' },
      {
        iss: cfg.serviceAccountEmail,
        aud: 'google',
        typ: 'savetowallet',
        iat: Math.floor(Date.now() / 1000),
        origins,
        payload: {
          genericClasses: [genericClass],
          genericObjects: [genericObject],
        },
      },
      cfg.privateKey,
    );
    return { ok: true, url: `https://pay.google.com/gp/v/save/${token}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to sign Google Wallet JWT';
    return { ok: false, error: msg, status: 500 };
  }
}
