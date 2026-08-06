import { describe, expect, it } from 'vitest';

import {
  isAiProviderId,
  resolveAiProviderPreference,
} from '@/lib/ai/resolve';
import { PLATFORM_DEFAULT_AI_PROVIDER } from '@/lib/ai/types';

describe('resolveAiProviderPreference', () => {
  it('defaults to platform Grok when nothing set', () => {
    expect(resolveAiProviderPreference({})).toEqual({
      provider: 'grok',
      source: 'platform',
    });
    expect(PLATFORM_DEFAULT_AI_PROVIDER).toBe('grok');
  });

  it('uses org default over platform', () => {
    expect(
      resolveAiProviderPreference({ orgDefault: 'claude' }),
    ).toEqual({ provider: 'claude', source: 'org' });
  });

  it('uses user preference over org and platform', () => {
    expect(
      resolveAiProviderPreference({
        userPreferred: 'claude',
        orgDefault: 'grok',
        platformDefault: 'grok',
      }),
    ).toEqual({ provider: 'claude', source: 'user' });

    expect(
      resolveAiProviderPreference({
        userPreferred: 'grok',
        orgDefault: 'claude',
      }),
    ).toEqual({ provider: 'grok', source: 'user' });
  });

  it('ignores invalid preference values', () => {
    expect(
      resolveAiProviderPreference({
        userPreferred: 'copilot' as never,
        orgDefault: 'gpt' as never,
      }),
    ).toEqual({ provider: 'grok', source: 'platform' });
  });

  it('treats null user as inherit org', () => {
    expect(
      resolveAiProviderPreference({
        userPreferred: null,
        orgDefault: 'claude',
      }),
    ).toEqual({ provider: 'claude', source: 'org' });
  });
});

describe('isAiProviderId', () => {
  it('accepts grok and claude only', () => {
    expect(isAiProviderId('grok')).toBe(true);
    expect(isAiProviderId('claude')).toBe(true);
    expect(isAiProviderId('copilot')).toBe(false);
    expect(isAiProviderId(undefined)).toBe(false);
  });
});
