'use client';

import { useId, useState, useTransition } from 'react';

type Props = {
  publicId: string;
  sourceChannel: string;
  entryPath: string;
  entityId: string;
  onSuccess: () => void;
  primary: string;
  accent: string;
};

export function ExchangeForm({
  publicId,
  sourceChannel,
  entryPath,
  entityId,
  onSuccess,
  primary,
  accent,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const honeypotId = useId();
  const showRecruitIntent = entityId === 'ENT-R619';

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const payload = {
      public_id: publicId,
      name: String(fd.get('name') || ''),
      email: String(fd.get('email') || ''),
      phone: String(fd.get('phone') || ''),
      company: String(fd.get('company') || ''),
      title: String(fd.get('title') || ''),
      note: String(fd.get('note') || ''),
      how_we_met: String(fd.get('how_we_met') || ''),
      intent: String(fd.get('intent') || ''),
      consent_marketing: fd.get('consent_marketing') === 'on',
      website: String(fd.get('website') || ''),
      source_channel: sourceChannel,
      entry_path: entryPath,
      external_submission_id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : undefined,
    };

    startTransition(async () => {
      try {
        const res = await fetch('/api/card/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) {
          setError(json.error || 'Could not send — try again');
          return;
        }
        onSuccess();
      } catch {
        setError('Network error — try again');
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3">
      <Field label="Name *" name="name" required autoComplete="name" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
      </div>
      <p className="text-xs text-[#7c7871]">Email or phone is required.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Company" name="company" autoComplete="organization" />
        <Field label="Title" name="title" autoComplete="organization-title" />
      </div>
      <Field label="How we met" name="how_we_met" />
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[#7c7871]">
          Note
        </span>
        <textarea
          name="note"
          rows={3}
          className="w-full rounded-xl border border-[#e0dcd2] bg-[#faf8f4] px-3 py-2.5 text-sm text-[#3B4559] outline-none focus:border-[#B2A384]"
        />
      </label>

      {showRecruitIntent ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[#7c7871]">
            I&apos;m interested in
          </span>
          <select
            name="intent"
            className="w-full rounded-xl border border-[#e0dcd2] bg-[#faf8f4] px-3 py-2.5 text-sm text-[#3B4559]"
            defaultValue=""
          >
            <option value="">Just connecting</option>
            <option value="hiring">Hiring / need talent</option>
            <option value="jobseek">Finding work</option>
          </select>
        </label>
      ) : null}

      <label className="flex items-start gap-2 text-xs leading-relaxed text-[#7c7871]">
        <input
          type="checkbox"
          name="consent_marketing"
          className="mt-0.5"
        />
        <span>
          Optional: I agree to be contacted about relevant opportunities. You
          can opt out anytime.
        </span>
      </label>

      {/* Honeypot */}
      <div
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0"
      >
        <label htmlFor={honeypotId}>Website</label>
        <input id={honeypotId} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
        style={{
          background: `linear-gradient(135deg, ${primary}, ${accent})`,
        }}
      >
        {pending ? 'Sending…' : 'Send to them'}
      </button>
    </form>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[#7c7871]">
        {props.label}
      </span>
      <input
        name={props.name}
        type={props.type || 'text'}
        required={props.required}
        autoComplete={props.autoComplete}
        className="w-full rounded-xl border border-[#e0dcd2] bg-[#faf8f4] px-3 py-2.5 text-sm text-[#3B4559] outline-none focus:border-[#B2A384]"
      />
    </label>
  );
}
