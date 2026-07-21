import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import { recoverDocuSignSendIntents } from '@/lib/docusign/send-intents-repo';

async function authorize(request: Request) {
  const secret = process.env.CRON_SECRET || '';
  if (
    secret &&
    request.headers.get('authorization') === `Bearer ${secret}`
  ) {
    return true;
  }
  const gate = await guardPermission('write:documents');
  return gate.ok;
}

async function run(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const result = await recoverDocuSignSendIntents(20);
  return NextResponse.json(result, { status: 'error' in result ? 500 : 200 });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
