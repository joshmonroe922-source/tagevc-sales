import { afterEach, describe, expect, it } from 'vitest';
import {
  distroGroupCreateEnabled,
  distroGroupMailNickname,
  isDistroStep,
  parseDistroGroupEnv,
} from '@/lib/hris/distro-step';

const original = process.env.MS_GRAPH_CREATE_DISTRO_GROUPS;

afterEach(() => {
  if (original === undefined) delete process.env.MS_GRAPH_CREATE_DISTRO_GROUPS;
  else process.env.MS_GRAPH_CREATE_DISTRO_GROUPS = original;
});

describe('distroGroupCreateEnabled', () => {
  it('is off unless explicitly enabled, so onboarding never writes a group by default', () => {
    delete process.env.MS_GRAPH_CREATE_DISTRO_GROUPS;
    expect(distroGroupCreateEnabled()).toBe(false);
    for (const value of ['', '0', 'false', 'off', 'no']) {
      process.env.MS_GRAPH_CREATE_DISTRO_GROUPS = value;
      expect(distroGroupCreateEnabled()).toBe(false);
    }
  });

  it('accepts the flag spellings used elsewhere in the env', () => {
    for (const value of ['1', 'true', 'TRUE', 'on']) {
      process.env.MS_GRAPH_CREATE_DISTRO_GROUPS = value;
      expect(distroGroupCreateEnabled()).toBe(true);
    }
  });
});

describe('distroGroupMailNickname', () => {
  it('strips the characters Entra rejects in a mailNickname', () => {
    expect(distroGroupMailNickname('Recruit 619')).toBe('recruit-619-all');
    expect(distroGroupMailNickname('Tage Venture Capital, LLC.')).toBe(
      'tage-venture-capital-llc-all',
    );
    expect(distroGroupMailNickname('Recruit 619')).not.toMatch(/[\s@()[\];:.<>,"]/);
  });

  it('still returns a usable nickname for unusable input', () => {
    expect(distroGroupMailNickname('   ')).toBe('entity-all');
    expect(distroGroupMailNickname('!!!')).toBe('entity-all');
  });
});

describe('parseDistroGroupEnv', () => {
  it('maps canonical entity ids to group ids', () => {
    expect(parseDistroGroupEnv('ENT-R619=abc, ENT-FIRM=def')).toEqual({
      'ENT-R619': 'abc',
      'ENT-FIRM': 'def',
    });
  });

  it('ignores blanks and malformed pairs', () => {
    expect(parseDistroGroupEnv(undefined)).toEqual({});
    expect(parseDistroGroupEnv('ENT-R619=,=abc,garbage')).toEqual({});
  });
});

describe('isDistroStep', () => {
  it('matches on step key or system hook', () => {
    expect(isDistroStep({ step_key: 'sd.distro', system_hook: null })).toBe(true);
    expect(isDistroStep({ step_key: 'sd.other', system_hook: 'distro_add' })).toBe(true);
    expect(isDistroStep({ step_key: 'sd.other', system_hook: null })).toBe(false);
  });
});
