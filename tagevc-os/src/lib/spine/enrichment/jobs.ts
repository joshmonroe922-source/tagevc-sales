/**
 * Enrichment job helpers — enqueue shapes + idempotency keys (05_Events_Jobs).
 */

import { createHash } from 'crypto';

export type EnrichmentJobType =
  | 'account.bootstrap'
  | 'account.enrich'
  | 'account.expand_people'
  | 'contact.bootstrap'
  | 'contact.enrich'
  | 'contact.peers'
  | 'account.hierarchy'
  | 'account.site_research'
  | 'contact.refresh_stale'
  | 'account.refresh_stale'
  | 'agent.routing'
  | 'agent.data_qa';

export function accountBootstrapKey(accountId: string, orgId: string, day?: string): string {
  const d = day ?? new Date().toISOString().slice(0, 10);
  return `account.bootstrap:${accountId}:${orgId}:${d}`;
}

export function contactEnrichKey(contactId: string, versionTarget: number): string {
  return `contact.enrich:${contactId}:${versionTarget}`;
}

export function expandPeopleKey(
  accountId: string,
  patterns: string[],
  cap: number,
): string {
  const h = createHash('sha256')
    .update(patterns.slice().sort().join('|'))
    .digest('hex')
    .slice(0, 12);
  return `account.expand_people:${accountId}:${h}:${cap}`;
}

export function websiteRoutingKey(leadId: string, day?: string): string {
  const d = day ?? new Date().toISOString().slice(0, 10);
  return `agent.routing:website:${leadId}:${d}`;
}
