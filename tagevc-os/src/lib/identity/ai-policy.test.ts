import { describe, expect, it } from 'vitest';
import {
  assertAiActionAllowed,
  aiForbidList,
  classifyAiAction,
} from '@/lib/identity/ai-policy';

describe('AI CTO policy', () => {
  it('forbids full wipe and disable without human', () => {
    expect(classifyAiAction('intune.device.wipe')).toBe('L4_FORBIDDEN');
    expect(classifyAiAction('entra.user.disable')).toBe('L4_FORBIDDEN');
    expect(assertAiActionAllowed({ action: 'wipe' }).ok).toBe(false);
  });

  it('allows L1 reads', () => {
    expect(classifyAiAction('explain_case')).toBe('L1');
    expect(assertAiActionAllowed({ action: 'explain_case' }).ok).toBe(true);
  });

  it('gates L3 selective wipe on human approval', () => {
    expect(
      assertAiActionAllowed({ action: 'intune.byod.selective_wipe' }).ok,
    ).toBe(false);
    expect(
      assertAiActionAllowed({
        action: 'intune.byod.selective_wipe',
        human_approved: true,
      }).ok,
    ).toBe(true);
  });

  it('forbids unattended remote help', () => {
    expect(aiForbidList()).toContain('unattended_remote_help');
  });
});
