/**
 * Recruit 619 ↔ Salesforce resume sync (scaffold).
 *
 * Status: scaffold — not live until SF Connected App secrets are set.
 * See SETUP_SALESFORCE_RESUMES.md.
 *
 * Actions:
 *   status  — connection / entity gate / last sync metadata
 *   sync    — list Company Resumes, extract contact heuristics, upsert SF records (when wired)
 *   parse   — dry-run extract for one drive item (no SF write)
 */

import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  ensureCompanyResumesVault,
  ensurePortalVault,
  extractResumeTextHint,
  parseContactHeuristic,
} from '../_shared/documentVault.ts';
import {
  fetchDriveItemByDrive,
  fetchDriveItemChildrenByDrive,
  getMsConfig,
  getValidAccessToken,
  requireActiveSalesUser,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

const PATH = '/sales/files';
const RECRUIT_SLUG = 'recruit-619';

type Body = {
  action?: 'status' | 'sync' | 'parse';
  item_id?: string;
  drive_id?: string | null;
  /** When true, do not write to Salesforce even if configured. */
  dry_run?: boolean;
  audit?: boolean;
};

function sfConfigured(): boolean {
  return Boolean(
    (Deno.env.get('SF_CLIENT_ID') ?? '').trim() &&
      (Deno.env.get('SF_CLIENT_SECRET') ?? '').trim() &&
      ((Deno.env.get('SF_REFRESH_TOKEN') ?? '').trim() ||
        ((Deno.env.get('SF_USERNAME') ?? '').trim() &&
          (Deno.env.get('SF_PASSWORD') ?? '').trim())),
  );
}

function sfObjectApiName(): string {
  return (Deno.env.get('SF_CANDIDATE_OBJECT') ?? 'Contact').trim() || 'Contact';
}

async function userHasRecruit619(
  // deno-lint-ignore no-explicit-any
  service: any,
  salesUserId: string,
  isAdmin: boolean,
): Promise<{ ok: boolean; entityId: string | null; reason: string | null }> {
  const { data: entity } = await service
    .from('ops_entities')
    .select('id, slug, name')
    .eq('slug', RECRUIT_SLUG)
    .maybeSingle();

  if (!entity?.id) {
    return {
      ok: false,
      entityId: null,
      reason: `Entity slug ${RECRUIT_SLUG} not found in ops_entities`,
    };
  }

  if (isAdmin) {
    return { ok: true, entityId: entity.id, reason: null };
  }

  const { data: assignment } = await service
    .from('ops_entity_assignments')
    .select('id')
    .eq('user_id', salesUserId)
    .eq('entity_id', entity.id)
    .maybeSingle();

  if (!assignment) {
    return {
      ok: false,
      entityId: entity.id,
      reason: 'User is not assigned to Recruit 619 (ops_entity_assignments)',
    };
  }
  return { ok: true, entityId: entity.id, reason: null };
}

async function downloadDriveContent(
  accessToken: string,
  driveId: string,
  itemId: string,
): Promise<Uint8Array> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
    { headers: { Authorization: `Bearer ${accessToken}` }, redirect: 'follow' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to read drive content: ${res.status} ${text.slice(0, 160)}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf;
}

/** Placeholder SF upsert — returns not_wired until secrets + API client are completed. */
async function upsertSalesforceCandidate(_input: {
  email: string | null;
  phone: string | null;
  name: string | null;
  fileName: string;
  driveItemId: string;
  textSnippet: string;
}): Promise<{ status: 'created' | 'updated' | 'skipped' | 'not_wired'; sf_id: string | null; detail: string }> {
  if (!sfConfigured()) {
    return {
      status: 'not_wired',
      sf_id: null,
      detail:
        'Set SF_CLIENT_ID, SF_CLIENT_SECRET, and SF_REFRESH_TOKEN (or SF_USERNAME + SF_PASSWORD) — see SETUP_SALESFORCE_RESUMES.md',
    };
  }
  // Live jsforce / REST upsert lands here in a follow-up once Connected App is approved.
  return {
    status: 'not_wired',
    sf_id: null,
    detail:
      'Salesforce secrets present but API client not implemented yet. Duplicate key = email → phone → name heuristic; object = SF_CANDIDATE_OBJECT (default Contact).',
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const userClient = createUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const service = createServiceClient();
    const salesUser = await requireActiveSalesUser(service, user.email);
    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    const body = (await req.json().catch(() => ({}))) as Body;
    const action = body.action ?? 'status';
    const recruit = await userHasRecruit619(
      service,
      salesUser.id,
      salesUser.role === 'admin',
    );

    if (action === 'status') {
      return jsonResponse(
        {
          live: false,
          wired: sfConfigured(),
          recruit_619: recruit,
          sf_object: sfObjectApiName(),
          duplicate_keys: ['email', 'phone', 'name'],
          parsing:
            'Extractable PDF string literals + DOCX byte heuristics only. Scanned/image PDFs need OCR or AI (not in v1).',
          message: sfConfigured()
            ? 'Secrets detected; API upsert still scaffolded — connect via SETUP_SALESFORCE_RESUMES.md.'
            : 'Scaffold only. Configure Salesforce Connected App secrets to go live.',
        },
        200,
        origin,
      );
    }

    const msConfig = getMsConfig();
    if (!msConfig.configured) {
      return jsonResponse({ error: 'Microsoft Graph is not configured' }, 503, origin);
    }

    let accessToken: string;
    let scopes: string | null = null;
    try {
      const result = await getValidAccessToken(service, msConfig, salesUser.id);
      accessToken = result.accessToken;
      scopes = result.connection.scopes ?? null;
    } catch (err) {
      return jsonResponse(
        {
          error: err instanceof Error ? err.message : 'Not connected',
          needs_reconnect: true,
        },
        401,
        origin,
      );
    }

    if (action === 'parse') {
      const itemId = (body.item_id ?? '').trim();
      const driveId = (body.drive_id ?? '').trim();
      if (!itemId || !driveId) {
        return jsonResponse({ error: 'item_id and drive_id are required' }, 400, origin);
      }
      const meta = await fetchDriveItemByDrive(accessToken, driveId, itemId);
      const bytes = await downloadDriveContent(accessToken, driveId, itemId);
      const extracted = extractResumeTextHint(meta.name ?? 'file', bytes);
      const contact = parseContactHeuristic(extracted.text);
      return jsonResponse(
        {
          item: { id: meta.id, name: meta.name, size: meta.size },
          extract: extracted,
          contact,
          note: extracted.needs_ocr
            ? 'Weak extract — scanned resumes need OCR/AI before reliable SF upsert.'
            : null,
        },
        200,
        origin,
      );
    }

    if (action === 'sync') {
      if (!recruit.ok) {
        return jsonResponse(
          {
            error: recruit.reason,
            recruit_619: recruit,
            message: 'Resume→Salesforce sync is gated to Recruit 619 assignees (and admins).',
          },
          403,
          origin,
        );
      }

      const vault = await ensurePortalVault(accessToken, scopes);
      const company = vault.company.available
        ? vault.company
        : await ensureCompanyResumesVault(accessToken, scopes);

      if (!company.available || !company.resumes?.drive_id) {
        return jsonResponse(
          {
            error: company.message || 'Company Resumes folder unavailable',
            company,
          },
          503,
          origin,
        );
      }

      const kids = await fetchDriveItemChildrenByDrive(
        accessToken,
        company.resumes.drive_id,
        company.resumes.item_id,
      );
      const files = kids.filter((k) => !k.folder && k.id);

      const results: Array<Record<string, unknown>> = [];
      for (const file of files.slice(0, 25)) {
        try {
          const bytes = await downloadDriveContent(
            accessToken,
            company.resumes.drive_id,
            file.id!,
          );
          const extracted = extractResumeTextHint(file.name ?? 'file', bytes);
          const contact = parseContactHeuristic(extracted.text);
          const sf = body.dry_run
            ? {
                status: 'skipped' as const,
                sf_id: null,
                detail: 'dry_run',
              }
            : await upsertSalesforceCandidate({
                email: contact.email,
                phone: contact.phone,
                name: contact.name,
                fileName: file.name ?? 'resume',
                driveItemId: file.id!,
                textSnippet: extracted.text.slice(0, 500),
              });

          // Persist sync cursor when table exists (migration 0018)
          try {
            await service.from('sf_resume_sync_items').upsert(
              {
                drive_item_id: file.id,
                drive_id: company.resumes.drive_id,
                file_name: file.name ?? null,
                entity_id: recruit.entityId,
                email_guess: contact.email,
                phone_guess: contact.phone,
                name_guess: contact.name,
                parse_method: extracted.method,
                needs_ocr: extracted.needs_ocr,
                sf_status: sf.status,
                sf_record_id: sf.sf_id,
                last_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'drive_item_id' },
            );
          } catch {
            /* table may not be migrated yet */
          }

          results.push({
            name: file.name,
            item_id: file.id,
            contact,
            needs_ocr: extracted.needs_ocr,
            sf,
          });
        } catch (err) {
          results.push({
            name: file.name,
            item_id: file.id,
            error: err instanceof Error ? err.message : 'parse failed',
          });
        }
      }

      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'sf_resume_sync',
          path: PATH,
          metadata: {
            entity_id: recruit.entityId,
            count: results.length,
            wired: sfConfigured(),
            dry_run: Boolean(body.dry_run),
          },
        });
      }

      return jsonResponse(
        {
          live: false,
          wired: sfConfigured(),
          recruit_619: recruit,
          folder: company.resumes,
          results,
          message:
            'Scaffold sync complete. Salesforce upserts remain not_wired until Connected App + API client land.',
        },
        200,
        origin,
      );
    }

    return jsonResponse({ error: 'Unknown action' }, 400, origin);
  } catch (err) {
    console.error('salesforce-resume-sync', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      500,
      origin,
    );
  }
});
