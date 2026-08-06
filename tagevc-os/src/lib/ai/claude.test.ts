import { afterEach, describe, expect, it, vi } from 'vitest';

import { claudeChatCompletion } from '@/lib/ai/claude';
import {
  claudeConfigured,
  claudeLiveEnabled,
  claudeSelectableInSettings,
} from '@/lib/ai/flags';

const KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_LIVE',
  'CLAUDE_LIVE',
  'AI_CLAUDE_ENABLED',
  'AI_CLAUDE_FEATURE',
  'CLAUDE_FEATURE',
] as const;

describe('claude fail-closed gates', () => {
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    vi.unstubAllGlobals();
  });

  it('does not call Anthropic without LIVE even when key present', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(claudeConfigured()).toBe(true);
    expect(claudeLiveEnabled()).toBe(false);

    const result = await claudeChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.content).toBeNull();
    expect(result.error).toMatch(/ANTHROPIC/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('LIVE without key stays fail-closed', async () => {
    process.env.ANTHROPIC_LIVE = '1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(claudeLiveEnabled()).toBe(false);
    const result = await claudeChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.content).toBeNull();
  });

  it('shows Claude in settings when key or feature flag set', () => {
    expect(claudeSelectableInSettings(false)).toBe(false);
    process.env.AI_CLAUDE_FEATURE = '1';
    expect(claudeSelectableInSettings(false)).toBe(true);
    delete process.env.AI_CLAUDE_FEATURE;
    expect(claudeSelectableInSettings(true)).toBe(true);
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    expect(claudeSelectableInSettings(false)).toBe(true);
  });
});
