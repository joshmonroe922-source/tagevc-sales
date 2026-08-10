import { describe, expect, it } from 'vitest';
import {
  accordionSiblingLabels,
  exclusiveAccordionToggle,
} from './accordion';

describe('exclusiveAccordionToggle', () => {
  it('opens one group and collapses sibling groups', () => {
    const prev = { Assets: true, Firm: false, Grow: false };
    const next = exclusiveAccordionToggle(prev, 'Grow', [
      'Assets',
      'Firm',
      'Grow',
    ]);
    expect(next).toEqual({ Assets: false, Firm: false, Grow: true });
  });

  it('collapses the open group without touching other keys', () => {
    const prev = { Assets: true, nestedHr: true };
    const next = exclusiveAccordionToggle(prev, 'Assets', [
      'Assets',
      'Firm',
      'Grow',
    ]);
    expect(next).toEqual({ Assets: false, nestedHr: true });
  });

  it('keeps unrelated nested keys when switching top-level peers', () => {
    const prev = {
      'Shared Services': true,
      HR: true,
      Grow: false,
    };
    const next = exclusiveAccordionToggle(prev, 'Grow', [
      'Shared Services',
      'Grow',
    ]);
    expect(next).toEqual({
      'Shared Services': false,
      HR: true,
      Grow: true,
    });
  });

  it('exclusively expands nested siblings', () => {
    const prev = { HR: true, IT: false, Admin: false };
    const next = exclusiveAccordionToggle(prev, 'IT', ['HR', 'IT', 'Admin']);
    expect(next).toEqual({ HR: false, IT: true, Admin: false });
  });
});

describe('accordionSiblingLabels', () => {
  it('returns only items with children', () => {
    expect(
      accordionSiblingLabels([
        { label: 'Home' },
        { label: 'Assets', children: [{ label: 'Net Worth' }] },
        { label: 'Dashboard' },
        { label: 'Grow', children: [{ label: 'Training' }] },
      ]),
    ).toEqual(['Assets', 'Grow']);
  });
});
