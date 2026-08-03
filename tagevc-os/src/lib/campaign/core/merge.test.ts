import { describe, expect, it } from 'vitest';
import { assertNoRawTokens, renderMergeTemplate } from './merge';

describe('renderMergeTemplate', () => {
  it('merges contact fields and fallbacks', () => {
    const { rendered, missing } = renderMergeTemplate(
      'Hi {{contact.first_name | default: "there"}} @ {{account.name}}',
      {
        contact: { first_name: 'Josh' },
        account: {},
      },
    );
    expect(rendered).toContain('Josh');
    expect(missing).toContain('account.name');
  });

  it('escapes HTML in values', () => {
    const { rendered } = renderMergeTemplate('{{contact.first_name}}', {
      contact: { first_name: '<script>' },
    });
    expect(rendered).toBe('&lt;script&gt;');
  });

  it('detects leftover tokens', () => {
    expect(assertNoRawTokens('Hi {{contact.x}}')).toContain('contact.x');
  });
});
