import type { CampaignStatus } from './types';

const TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['scheduled', 'sending', 'cancelled'],
  scheduled: ['sending', 'paused', 'cancelled'],
  sending: ['sent', 'paused', 'cancelled'],
  sent: [],
  paused: ['scheduled', 'sending', 'cancelled'],
  cancelled: [],
};

export function canTransition(
  from: CampaignStatus,
  to: CampaignStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: CampaignStatus, to: CampaignStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid campaign transition ${from} → ${to}`);
  }
}
