import { describe, expect, it } from 'vitest';
import { evaluateSegment, filterContactsBySegment } from './segment-dsl';

describe('segment DSL', () => {
  const contacts = [
    {
      id: '1',
      primary_email: 'a@x.com',
      email_permission: 'opted_in',
      lifecycle: 'Active',
    },
    {
      id: '2',
      primary_email: 'b@x.com',
      email_permission: 'opted_out',
      lifecycle: 'Inactive',
    },
  ];

  it('filters opted_in with email', () => {
    const matched = filterContactsBySegment(contacts, {
      op: 'and',
      rules: [
        { field: 'contact.email_permission', op: 'eq', value: 'opted_in' },
        { field: 'contact.primary_email', op: 'exists' },
      ],
    });
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe('1');
  });

  it('supports or groups', () => {
    expect(
      evaluateSegment(contacts[1], {
        op: 'or',
        rules: [
          { field: 'lifecycle', op: 'eq', value: 'Active' },
          { field: 'lifecycle', op: 'eq', value: 'Inactive' },
        ],
      }),
    ).toBe(true);
  });
});
