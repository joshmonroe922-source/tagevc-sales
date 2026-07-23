import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHASE59_ENTITY_FILTER_HINT,
  PHASE59_NOTIFICATIONS_CONTRACT_VERSION,
  boardStatusLabel,
  channelLabel,
  defaultNotificationPrefsPhase59,
  emptyPracticalNotificationsPhase59Report,
  severityLabel,
} from './practical-notifications-phase59';

const sqlPath = resolve(
  process.cwd(),
  'supabase/phase59_practical_notifications.sql',
);

describe('Phase 59 practical production notifications', () => {
  it('never mentions the retired os_store_snapshots identifier', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).not.toContain('os_store_snapshots');
  });

  it('adds append-only delivery/routing/inbox evidence + RPCs', () => {
    const sql = readFileSync(sqlPath, 'utf8')
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sql).toContain(
      'create table if not exists public.os_notification_delivery_phase59_evidence',
    );
    expect(sql).toContain(
      'create table if not exists public.os_notification_routing_phase59_events',
    );
    expect(sql).toContain(
      'create table if not exists public.os_notification_inbox_phase59_snapshots',
    );
    expect(sql).toContain(
      'create table if not exists public.os_notification_phase59_ops_alerts',
    );
    expect(sql).toContain('email_critical_digests');
    expect(sql).toContain('notify_critical_events');
    expect(sql).toContain('notify_owner_assignments');
    expect(sql).toContain('upsert_notification_prefs_phase59');
    expect(sql).toContain('record_notification_delivery_phase59');
    expect(sql).toContain('route_notification_phase59');
    expect(sql).toContain('refresh_notification_inbox_phase59');
    expect(sql).toContain('get_practical_notifications_phase59_report');
    expect(sql).toContain('mark_critical_email_delivery_phase59');
    expect(sql).toContain('phase59_notifications_safe_detail');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    expect(sql).toContain("'phase59-v1'");
    expect(sql).toContain("'full_push',false");
    expect(sql).toContain('email_critical');
    expect(sql).toContain('ENT-R619');
    expect(sql).toContain('ENT-INDA');
    expect(sql).toContain(
      'Practical notifications Phase 59 evidence is append-only',
    );
    expect(sql).not.toMatch(/if\s+case\s+when/i);
  });

  it('uses os_sha256_hex and avoids bare CASE inside IF conditions', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('public.os_sha256_hex');
    expect(sql).toContain('set search_path = public, extensions');
    const withoutHelper = sql.replace(
      /create or replace function public\.os_sha256_hex[\s\S]*?\$\$;/,
      '',
    );
    expect(withoutHelper).not.toMatch(/encode\(digest\(/);
    expect(withoutHelper).not.toMatch(/\bdigest\s*\(/);
    const plpgsqlBodies = sql.split(/language plpgsql[\s\S]*?as \$\$/);
    for (const body of plpgsqlBodies.slice(1)) {
      const untilEnd = body.slice(0, body.indexOf('$$'));
      expect(untilEnd).not.toMatch(
        /\bif\b(?!\s+not\s+exists)[\s\S]{0,80}\bcase\s+when\b[\s\S]{0,60}\bthen\b/i,
      );
    }
  });

  it('never invents a full push system', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('full_push');
    expect(sql).toContain("'full_push',false");
    expect(sql).not.toMatch(/fcm|apns|web_push|push_subscription/i);
    expect(sql).toContain("channel in ('in_app','email_critical')");
  });

  it('is entity-scoped via RLS and can_access_entity', () => {
    const sql = readFileSync(sqlPath, 'utf8');
    expect(sql).toContain(
      'alter table public.os_notification_delivery_phase59_evidence',
    );
    expect(sql).toContain('enable row level security');
    expect(sql).toContain('public.can_access_entity(entity_id)');
    expect(sql).toContain('public.is_firm_wide_access()');
    expect(sql).toMatch(
      /public\.get_practical_notifications_phase59_report\(\s*\n?\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.refresh_notification_inbox_phase59\(\s*\n?\s*uuid,\s*text\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
    expect(sql).toMatch(
      /public\.route_notification_phase59\(\s*\n?\s*jsonb\s*\n?\s*\)[\s\S]*?to authenticated, service_role/,
    );
  });

  it('empty stub report keeps full_push false and hints ENT-R619', () => {
    const report = emptyPracticalNotificationsPhase59Report();
    expect(report.board_status).toBe('missing');
    expect(report.full_push).toBe(false);
    expect(report.email_critical_only).toBe(true);
    expect(report.reuses_digest_route).toBe(true);
    expect(report.reuses_notification_prefs).toBe(true);
    expect(report.contract_version).toBe(PHASE59_NOTIFICATIONS_CONTRACT_VERSION);
    expect(report.entity_filter_hint).toBe(PHASE59_ENTITY_FILTER_HINT);
    const prefs = defaultNotificationPrefsPhase59('user-1');
    expect(prefs.email_critical_digests).toBe(true);
    expect(prefs.notify_critical_events).toBe(true);
    expect(prefs.notify_owner_assignments).toBe(true);
    expect(prefs.full_push).toBe(false);
    expect(boardStatusLabel('partial')).toBe('Partial');
    expect(severityLabel('critical')).toBe('Critical');
    expect(channelLabel('email_critical')).toBe('Critical email');
  });

  it('wires prefs center, inbox groups, digest critical email, and Phase 59 panel', () => {
    const lib = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/notifications/practical-notifications-phase59.ts',
      ),
      'utf8',
    );
    const server = readFileSync(
      resolve(
        process.cwd(),
        'src/lib/notifications/practical-notifications-phase59-server.ts',
      ),
      'utf8',
    );
    const prefsForm = readFileSync(
      resolve(
        process.cwd(),
        'src/components/settings/notification-prefs-form.tsx',
      ),
      'utf8',
    );
    const settingsPage = readFileSync(
      resolve(process.cwd(), 'src/app/(app)/settings/notifications/page.tsx'),
      'utf8',
    );
    const actions = readFileSync(
      resolve(
        process.cwd(),
        'src/app/(app)/settings/notifications/actions.ts',
      ),
      'utf8',
    );
    const inbox = readFileSync(
      resolve(process.cwd(), 'src/components/activity/notification-inbox.tsx'),
      'utf8',
    );
    const digest = readFileSync(
      resolve(process.cwd(), 'src/app/api/notifications/digest/route.ts'),
      'utf8',
    );
    const ui = readFileSync(
      resolve(
        process.cwd(),
        'src/components/settings/practical-notifications-phase59-client.tsx',
      ),
      'utf8',
    );

    expect(lib).toContain(PHASE59_NOTIFICATIONS_CONTRACT_VERSION);
    expect(lib).toContain('TODO');
    expect(lib).not.toContain('createPersistClient');

    expect(server).toContain('getPracticalNotificationsPhase59Report');
    expect(server).toContain('routeNotificationPhase59');
    expect(server).toContain('markCriticalEmailDeliveryPhase59');
    expect(server).toContain('createPersistClient');
    expect(server).toContain('full_push: false');

    expect(prefsForm).toContain('email_critical_digests');
    expect(prefsForm).toContain('notify_critical_events');
    expect(prefsForm).toContain('notify_owner_assignments');
    expect(prefsForm).toContain('Critical email digests only');

    expect(settingsPage).toContain('PracticalNotificationsPhase59Client');
    expect(settingsPage).toContain('Preference center');

    expect(actions).toContain('upsert_notification_prefs_phase59');
    expect(actions).toContain('refreshNotificationInboxPhase59Action');
    expect(actions).toContain('routeDemoNotificationPhase59Action');

    expect(inbox).toContain('critical_event');
    expect(inbox).toContain('owner_routed');
    expect(inbox).toContain('Owner / assignee');

    expect(digest).toContain('email_critical_digests');
    expect(digest).toContain('critical_event');
    expect(digest).toContain('markCriticalEmailDeliveryPhase59');
    expect(digest).toContain('full_push: false');
    expect(digest).toContain('phase59-v1');

    expect(ui).toContain('Phase 59');
    expect(ui).toContain('full_push');
    expect(ui).toContain('ENT-R619');
  });
});
