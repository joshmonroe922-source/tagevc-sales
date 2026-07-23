'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  getNotificationPrefsAction,
  saveNotificationPrefsAction,
} from '@/app/(app)/settings/notifications/actions';
import { Button } from '@/components/ui/button';
import type { NotificationPrefs } from '@/lib/messaging/types';

export function NotificationPrefsForm() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    void (async () => {
      const result = await getNotificationPrefsAction();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPrefs(result.prefs);
    })();
  }, []);

  if (!prefs && !error) {
    return (
      <p className="text-sm text-muted-foreground">Loading preferences…</p>
    );
  }

  if (error && !prefs) {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (!prefs) return null;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        setError(null);
        start(async () => {
          const result = await saveNotificationPrefsAction({
            emailDigests: prefs.email_digests,
            digestFrequency: prefs.digest_frequency,
            notifyMentions: prefs.notify_mentions,
            notifyChatMessages: prefs.notify_chat_messages,
            emailCriticalDigests: prefs.email_critical_digests ?? true,
            notifyCriticalEvents: prefs.notify_critical_events ?? true,
            notifyOwnerAssignments: prefs.notify_owner_assignments ?? true,
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setPrefs(result.prefs);
          setSaved(true);
        });
      }}
    >
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={prefs.notify_mentions}
          onChange={(e) =>
            setPrefs({ ...prefs, notify_mentions: e.target.checked })
          }
        />
        <span>
          <span className="font-medium">@mention alerts</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            In-app notification when someone mentions you in chat.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={prefs.notify_chat_messages}
          onChange={(e) =>
            setPrefs({ ...prefs, notify_chat_messages: e.target.checked })
          }
        />
        <span>
          <span className="font-medium">Chat message alerts</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Notify on new messages in unmuted conversations.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={prefs.notify_critical_events ?? true}
          onChange={(e) =>
            setPrefs({ ...prefs, notify_critical_events: e.target.checked })
          }
        />
        <span>
          <span className="font-medium">Critical event alerts</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            In-app alerts for critical owner/assignee events (Phase 59).
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={prefs.notify_owner_assignments ?? true}
          onChange={(e) =>
            setPrefs({ ...prefs, notify_owner_assignments: e.target.checked })
          }
        />
        <span>
          <span className="font-medium">Owner / assignee routing</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            In-app when you are routed as owner or assignee.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={prefs.email_digests}
          onChange={(e) =>
            setPrefs({ ...prefs, email_digests: e.target.checked })
          }
        />
        <span>
          <span className="font-medium">Email digests (unread summary)</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Periodic summary of unread notifications (requires RESEND_API_KEY).
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={prefs.email_critical_digests ?? true}
          onChange={(e) =>
            setPrefs({ ...prefs, email_critical_digests: e.target.checked })
          }
        />
        <span>
          <span className="font-medium">Critical email digests only</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            Optional email when unread critical events exist — not a full push
            channel.
          </span>
        </span>
      </label>

      <div className="space-y-1.5">
        <label
          htmlFor="digest-freq"
          className="text-sm font-medium text-[#3a414f]"
        >
          Digest frequency
        </label>
        <select
          id="digest-freq"
          className="h-9 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm"
          value={prefs.digest_frequency}
          onChange={(e) =>
            setPrefs({
              ...prefs,
              digest_frequency: e.target
                .value as NotificationPrefs['digest_frequency'],
            })
          }
        >
          <option value="off">Off</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>

      {prefs.muted_conversation_ids.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {prefs.muted_conversation_ids.length} muted conversation
          {prefs.muted_conversation_ids.length === 1 ? '' : 's'} (manage from
          Messages).
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
      {saved ? (
        <p className="text-sm text-emerald-700">Preferences saved.</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save preferences'}
      </Button>
    </form>
  );
}
