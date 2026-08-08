/**
 * Apple Wallet (.pkpass) builder for digital business cards.
 */

import { PKPass } from 'passkit-generator';
import type { PublicCardPayload } from '@/lib/digital-cards/types';
import { taggedCardUrl } from '@/lib/digital-cards/urls';
import { TAGE_GOLD, TAGE_NAVY } from '@/lib/digital-cards/theme';
import { getAppleWalletConfig } from './config';
import { passImageBuffers } from './assets';

function hexToRgbCss(hex: string | undefined, fallback: string): string {
  const h = (hex || fallback).replace('#', '');
  if (h.length !== 6) return `rgb(59, 69, 89)`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

export function appleWalletReady(): boolean {
  return getAppleWalletConfig() !== null;
}

export async function buildApplePkPass(
  card: PublicCardPayload,
): Promise<{ ok: true; buffer: Buffer; filename: string } | { ok: false; error: string; status: number }> {
  const cfg = getAppleWalletConfig();
  if (!cfg) {
    return {
      ok: false,
      error: 'Apple Wallet is not configured',
      status: 503,
    };
  }
  if (card.revoked) {
    return { ok: false, error: 'Card revoked', status: 410 };
  }

  const walletUrl = taggedCardUrl(card.public_id, 'wallet');
  const { icon, logo } = await passImageBuffers(
    card.entity_id,
    card.theme.primary || TAGE_NAVY,
  );

  const email = card.emails[0]?.value || '';
  const phone = card.phones[0]?.value || '';

  try {
    const pass = new PKPass(
      {
        'icon.png': icon,
        'icon@2x.png': icon,
        'logo.png': logo,
        'logo@2x.png': logo,
      },
      {
        wwdr: cfg.wwdrCert,
        signerCert: cfg.signerCert,
        signerKey: cfg.signerKey,
        signerKeyPassphrase: cfg.signerKeyPassphrase || undefined,
      },
      {
        serialNumber: card.public_id,
        description: `${card.display_name} · ${card.company_name}`,
        organizationName: cfg.organizationName,
        passTypeIdentifier: cfg.passTypeIdentifier,
        teamIdentifier: cfg.teamIdentifier,
        foregroundColor: 'rgb(255, 255, 255)',
        backgroundColor: hexToRgbCss(card.theme.primary, TAGE_NAVY),
        labelColor: hexToRgbCss(card.theme.accent, TAGE_GOLD),
        logoText: card.company_name.slice(0, 24),
      },
    );

    // Must set type before fields — setter resets field arrays.
    pass.type = 'generic';
    pass.setBarcodes({
      format: 'PKBarcodeFormatQR',
      message: walletUrl,
      messageEncoding: 'iso-8859-1',
      altText: 'Open live card',
    });

    pass.primaryFields.push({
      key: 'name',
      label: 'NAME',
      value: card.display_name,
    });
    if (card.title) {
      pass.secondaryFields.push({
        key: 'title',
        label: 'TITLE',
        value: card.title,
      });
    }
    pass.secondaryFields.push({
      key: 'company',
      label: 'COMPANY',
      value: card.company_name,
    });

    const back: Array<{ key: string; label: string; value: string }> = [
      {
        key: 'card_url',
        label: 'Live card',
        value: walletUrl,
      },
    ];
    if (email) back.push({ key: 'email', label: 'Email', value: email });
    if (phone) back.push({ key: 'phone', label: 'Phone', value: phone });
    if (card.website) {
      back.push({ key: 'website', label: 'Website', value: card.website });
    }
    if (card.socials.linkedin) {
      back.push({
        key: 'linkedin',
        label: 'LinkedIn',
        value: card.socials.linkedin,
      });
    }
    if (card.bio_short) {
      back.push({ key: 'bio', label: 'About', value: card.bio_short });
    }
    for (const f of back) pass.backFields.push(f);

    const buffer = pass.getAsBuffer();
    const safe = card.display_name
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40);
    return {
      ok: true,
      buffer,
      filename: `${safe || 'card'}.pkpass`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to build pass';
    return { ok: false, error: msg, status: 500 };
  }
}
