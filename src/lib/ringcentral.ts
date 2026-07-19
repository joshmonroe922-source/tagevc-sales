/**
 * RingCentral Embeddable (softphone + SMS) — Phase 1 helpers.
 * Per-user PKCE login lives in the widget; we only pass clientId (no shared JWT).
 */

export const RC_ADAPTER_BASE =
  'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js';

export const RC_DEFAULT_REDIRECT_URI =
  'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/redirect.html';

export const RC_APP_SERVER_PRODUCTION = 'https://platform.ringcentral.com';

export type RcPendingComm = {
  kind: 'call' | 'sms';
  phoneE164: string;
  contactId?: string | null;
  leadId?: string | null;
  createdBy?: string | null;
  at: number;
};

type RcAdapterApi = {
  clickToCall?: (phoneNumber: string, toCall?: boolean) => void;
  clickToSMS?: (phoneNumber: string, text?: string) => void;
  setMinimized?: (minimized: boolean) => void;
  setClosed?: (closed: boolean) => void;
  dispose?: () => void;
};

declare global {
  interface Window {
    RCAdapter?: RcAdapterApi;
  }
}

/** Last click-to-call / click-to-SMS context for best-effort activity logging. */
let pendingComm: RcPendingComm | null = null;

export function getRingCentralClientId(): string {
  return (import.meta.env.VITE_RINGCENTRAL_CLIENT_ID as string | undefined)?.trim() ?? '';
}

export function getRingCentralAppServer(): string {
  const raw = (
    import.meta.env.VITE_RINGCENTRAL_APP_SERVER as string | undefined
  )?.trim();
  return raw || RC_APP_SERVER_PRODUCTION;
}

export function isRingCentralConfigured(): boolean {
  return Boolean(getRingCentralClientId());
}

/** Normalize to E.164 for Click-to-Dial / SMS. Defaults to US (+1) for 10-digit numbers. */
export function toE164(
  phone: string | null | undefined,
  defaultCountryCode = '1',
): string | null {
  const raw = (phone ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) {
    return `+${digits}`;
  }
  if (digits.length > 10) return `+${digits}`;
  return null;
}

export function setPendingRcComm(next: Omit<RcPendingComm, 'at'>): void {
  pendingComm = { ...next, at: Date.now() };
}

export function consumePendingRcComm(
  maxAgeMs = 15 * 60 * 1000,
): RcPendingComm | null {
  const cur = pendingComm;
  pendingComm = null;
  if (!cur) return null;
  if (Date.now() - cur.at > maxAgeMs) return null;
  return cur;
}

export function peekPendingRcComm(): RcPendingComm | null {
  return pendingComm;
}

function postToAdapter(payload: Record<string, unknown>): boolean {
  const frame = document.querySelector(
    '#rc-widget-adapter-frame',
  ) as HTMLIFrameElement | null;
  if (!frame?.contentWindow) return false;
  frame.contentWindow.postMessage(payload, '*');
  return true;
}

export function rcClickToCall(phone: string): boolean {
  const e164 = toE164(phone);
  if (!e164) return false;
  if (typeof window.RCAdapter?.clickToCall === 'function') {
    window.RCAdapter.clickToCall(e164);
    return true;
  }
  return postToAdapter({
    type: 'rc-adapter-new-call',
    phoneNumber: e164,
    toCall: true,
  });
}

export function rcClickToSMS(phone: string, text = ''): boolean {
  const e164 = toE164(phone);
  if (!e164) return false;
  if (typeof window.RCAdapter?.clickToSMS === 'function') {
    window.RCAdapter.clickToSMS(e164, text);
    return true;
  }
  return postToAdapter({
    type: 'rc-adapter-new-sms',
    phoneNumber: e164,
    ...(text ? { text } : {}),
  });
}

/** Absolute URL for Embeddable stylesUri (must be public HTTPS in production). */
export function getRingCentralStylesUri(): string {
  if (typeof window === 'undefined') return '';
  return new URL('/rc-embeddable-styles.css', window.location.origin).href;
}

export function buildAdapterScriptSrc(): string {
  const params = new URLSearchParams({
    clientId: getRingCentralClientId(),
    appServer: getRingCentralAppServer(),
    redirectUri: RC_DEFAULT_REDIRECT_URI,
  });
  const stylesUri = getRingCentralStylesUri();
  if (stylesUri) params.set('stylesUri', stylesUri);
  return `${RC_ADAPTER_BASE}?${params.toString()}`;
}

/** Digits-only match for comparing RC event numbers to pending E.164. */
export function phoneDigitsMatch(a: string, b: string): boolean {
  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

type RcCallPayload = {
  direction?: string;
  to?: string | { phoneNumber?: string };
  from?: string | { phoneNumber?: string };
  telephonyStatus?: string;
  result?: string;
  duration?: number;
  [key: string]: unknown;
};

function partyNumber(party: string | { phoneNumber?: string } | undefined): string {
  if (!party) return '';
  if (typeof party === 'string') return party;
  return party.phoneNumber ?? '';
}

/**
 * Best-effort activity logging from Embeddable postMessage events.
 * TODO(Phase 2): richer matching to sales_contacts by phone; dedicated call-logger
 * service; reliable SMS send confirmation via message events / webhooks.
 */
export function handleRcEmbeddableMessage(
  data: { type?: string; call?: RcCallPayload; message?: Record<string, unknown> },
  logFn: (input: {
    contactId: string;
    leadId?: string | null;
    activityType: 'sms_sent' | 'sms_received' | 'call_logged' | 'call_missed';
    summary: string;
    metadata?: Record<string, unknown>;
    createdBy?: string | null;
  }) => Promise<void>,
): void {
  if (!data?.type) return;

  if (data.type === 'rc-call-end-notify' && data.call) {
    const pending = peekPendingRcComm();
    const call = data.call;
    const remote =
      (call.direction || '').toLowerCase() === 'inbound'
        ? partyNumber(call.from)
        : partyNumber(call.to);
    const matchesPending =
      pending?.kind === 'call' &&
      pending.contactId &&
      (!remote || phoneDigitsMatch(remote, pending.phoneE164));

    if (!matchesPending || !pending?.contactId) {
      // No contact context — leave for Phase 2 phone→contact lookup.
      return;
    }

    const consumed = consumePendingRcComm();
    if (!consumed?.contactId) return;

    const dir = (call.direction || 'Outbound').toLowerCase();
    const result = String(call.result || call.telephonyStatus || '').toLowerCase();
    const missed =
      result.includes('missed') ||
      result.includes('noanswer') ||
      result.includes('no-answer') ||
      result.includes('rejected');

    void logFn({
      contactId: consumed.contactId,
      leadId: consumed.leadId,
      activityType: missed ? 'call_missed' : 'call_logged',
      summary: missed
        ? `Missed ${dir} call (${consumed.phoneE164})`
        : `${dir === 'inbound' ? 'Inbound' : 'Outbound'} call (${consumed.phoneE164})`,
      metadata: {
        source: 'ringcentral_embeddable',
        event: data.type,
        phone: consumed.phoneE164,
        call,
      },
      createdBy: consumed.createdBy,
    }).catch(() => {
      /* non-blocking */
    });
    return;
  }

  // Optimistic SMS activity on compose open is too noisy; wait for a send-ish event.
  if (
    (data.type === 'rc-inbound-message-notify' ||
      data.type === 'rc-message-updated-notify') &&
    data.message
  ) {
    // TODO(Phase 2): map SMS threads to contact_id and log sms_sent / sms_received.
  }
}
