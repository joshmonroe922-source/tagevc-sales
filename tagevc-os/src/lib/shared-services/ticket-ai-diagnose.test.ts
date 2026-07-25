import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { diagnoseTicket, assertCanAutoExecute } from './diagnose';
import { detectForbidHits } from './forbid-list';
import { matchAllowAction, isAllowListed } from './allow-list';
import { executeAllowListedAction } from './auto-executors';

describe('phase76 ticket diagnose bands', () => {
  it('AUTO when allow-listed parse retry + high confidence signals', () => {
    const d = diagnoseTicket({
      title: 'Credit parse failed — retry parse please',
      description: 'PDF parse failed on upload; retry parse for known env flag miss.',
      service: 'IT',
      priority: 'P3',
    });
    expect(d.proposed_action).toBe('retry_failed_parse');
    expect(d.on_allow_list).toBe(true);
    expect(d.band).toBe('AUTO');
    expect(d.forbid_hits).toHaveLength(0);
  });

  it('ESCALATE never AUTO on wire / credit dispute / role grant', () => {
    const money = diagnoseTicket({
      title: 'Wire funds to vendor',
      description: 'Please wire capital deploy payment today',
      service: 'Finance',
      priority: 'P1',
    });
    expect(money.band).toBe('ESCALATE');
    expect(money.forbid_hits.length).toBeGreaterThan(0);

    const credit = diagnoseTicket({
      title: 'File dispute on credit report',
      description: 'Need to dispute credit and overwrite fico',
      service: 'Finance',
      priority: 'P2',
    });
    expect(credit.band).toBe('ESCALATE');
    expect(credit.forbid_hits).toContain('credit_file_write');

    expect(() =>
      assertCanAutoExecute({
        band: 'AUTO',
        confidence: 99,
        forbid_hits: ['capital_wire'],
        on_allow_list: true,
        priority: 'P3',
      }),
    ).toThrow(/Forbid-list/);
  });

  it('AUTO executor records success for document_known_fix', async () => {
    expect(isAllowListed('document_known_fix')).toBe(true);
    expect(matchAllowAction('console noise known fix')).toBe('document_known_fix');
    const res = await executeAllowListedAction({
      action: 'document_known_fix',
      ticketId: 'TK-TEST-1',
      title: 'Known console noise',
      entityId: 'ENT-FIRM',
    });
    expect(res.result).toBe('success');
    expect(res.steps.length).toBeGreaterThan(0);
  });

  it('P0 always escalates even with allow signals', () => {
    const d = diagnoseTicket({
      title: 'SLA nudge overdue',
      description: 'Please send sla nudge reminder',
      service: 'IT',
      priority: 'P0',
    });
    expect(d.band).toBe('ESCALATE');
  });

  it('ships phase76 SQL without dropping store snapshots', () => {
    const sql = resolve(
      process.cwd(),
      'supabase/phase76_ticket_ai_diagnose.sql',
    );
    expect(existsSync(sql)).toBe(true);
    const body = readFileSync(sql, 'utf8');
    expect(body).toContain('proposed_actions');
    expect(body).toContain('auto_result');
    expect(body).toContain('source_system');
    expect(body).toContain('os_automation_metrics');
    expect(body).not.toMatch(/drop\s+table/i);
  });

  it('forbid detector catches new high-sensitivity signals', () => {
    expect(detectForbidHits('grant role visionary')).toContain(
      'role_permission_change',
    );
    expect(detectForbidHits('terminate employee now')).toContain('hr_termination');
  });
});
