import { NextResponse } from 'next/server';
import { getPersonaByPublicId, getTemplate, recordCardEvent } from '@/lib/digital-cards/repo';
import { toPublicCardPayload } from '@/lib/digital-cards/public-payload';
import { buildVCard, vcardFilename } from '@/lib/digital-cards/vcard';
import { parseSourceChannel } from '@/lib/digital-cards/urls';
import {
  clientIpFromRequest,
  enforcePublicRateLimit,
  hashedIpMeta,
} from '@/lib/digital-cards/rate-limit';

type Ctx = { params: Promise<{ public_id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  const { public_id } = await ctx.params;
  const url = new URL(request.url);
  const sourceChannel = parseSourceChannel(url.searchParams.get('src'));

  const ip = clientIpFromRequest(request);
  const rl = await enforcePublicRateLimit({
    kind: 'view',
    publicId: public_id,
    ip,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many requests' },
      { status: 429 },
    );
  }

  const persona = await getPersonaByPublicId(public_id, { service: true });
  if (!persona) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  if (persona.revoked_at || !persona.is_active) {
    return NextResponse.json(
      { ok: false, error: 'Card revoked' },
      { status: 410 },
    );
  }

  const template = await getTemplate(persona.entity_id, { service: true });
  const card = toPublicCardPayload(persona, template, { src: sourceChannel });
  const vcf = buildVCard(card);

  void recordCardEvent({
    personaId: persona.id,
    entityId: persona.entity_id,
    eventType: 'save_vcard',
    sourceChannel,
    meta: { ip_hash: hashedIpMeta(ip) },
    service: true,
  });

  return new NextResponse(vcf, {
    status: 200,
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': `attachment; filename="${vcardFilename(card.display_name)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
