import { NextResponse } from 'next/server';
import {
  buildL10WordHtml,
  getL10Meeting,
} from '@/lib/eos/l10-meetings';
import { getSessionContext } from '@/lib/rbac/session';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const meeting = await getL10Meeting(id);
  if (!meeting) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const html = buildL10WordHtml(meeting.notes_body, meeting.title);
  const filename = `${meeting.week_key}-${meeting.entity_id}-L10.doc`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
