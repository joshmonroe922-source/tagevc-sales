import {
  isRingCentralConfigured,
  rcClickToCall,
  rcClickToSMS,
  setPendingRcComm,
  toE164,
} from '../lib/ringcentral';

type Props = {
  phone?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  createdBy?: string | null;
  className?: string;
  /** Compact ghost buttons for dense headers. */
  size?: 'default' | 'compact';
};

export function PhoneActions({
  phone,
  contactId,
  leadId,
  createdBy,
  className = '',
  size = 'default',
}: Props) {
  const configured = isRingCentralConfigured();
  const e164 = toE164(phone);
  const disabled = !configured || !e164;
  const btnClass = size === 'compact' ? 'btn ghost small' : 'btn ghost';

  function onCall() {
    if (!e164) return;
    setPendingRcComm({
      kind: 'call',
      phoneE164: e164,
      contactId,
      leadId,
      createdBy,
    });
    const ok = rcClickToCall(e164);
    if (!ok) {
      window.alert(
        configured
          ? 'RingCentral widget is still loading. Open the Phone badge (bottom-right) and try again after signing in.'
          : 'RingCentral is not configured. See SETUP_RINGCENTRAL.md.',
      );
    }
  }

  function onSms() {
    if (!e164) return;
    setPendingRcComm({
      kind: 'sms',
      phoneE164: e164,
      contactId,
      leadId,
      createdBy,
    });
    const ok = rcClickToSMS(e164);
    if (!ok) {
      window.alert(
        configured
          ? 'RingCentral widget is still loading. Open the Phone badge (bottom-right) and try again after signing in.'
          : 'RingCentral is not configured. See SETUP_RINGCENTRAL.md.',
      );
    }
  }

  const title = !configured
    ? 'RingCentral not configured — set VITE_RINGCENTRAL_CLIENT_ID'
    : !e164
      ? 'Add a valid phone number first'
      : undefined;

  return (
    <div className={`phone-actions ${className}`.trim()} title={title}>
      <button
        type="button"
        className={btnClass}
        disabled={disabled}
        onClick={onCall}
      >
        Call
      </button>
      <button
        type="button"
        className={btnClass}
        disabled={disabled}
        onClick={onSms}
      >
        SMS
      </button>
    </div>
  );
}
