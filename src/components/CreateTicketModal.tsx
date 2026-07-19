import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  TicketAttachmentPicker,
  revokeTicketAttachmentDrafts,
} from './TicketAttachmentPicker';
import {
  capturePortalPageSnapshot,
  captureTicketDiagnosticContext,
} from '../lib/ticketCapture';
import { createTicket } from '../lib/ticketsApi';
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_CATEGORY_TEAM,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  type TicketAttachmentDraft,
  type TicketCategory,
  type TicketPriority,
} from '../lib/ticketTypes';
import type { SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
  open: boolean;
  onClose: () => void;
  preferredCategory?: TicketCategory | null;
};

function suggestCategory(
  pathname: string,
  preferred: TicketCategory | null | undefined,
): TicketCategory {
  if (preferred) return preferred;
  if (pathname.startsWith('/sales/technology')) return 'technology';
  if (pathname.startsWith('/sales/legal')) return 'legal';
  if (pathname.startsWith('/sales/finance')) return 'accounting-finance';
  if (pathname.startsWith('/sales/marketing') || pathname.startsWith('/sales/content'))
    return 'marketing';
  if (pathname.startsWith('/sales/hr')) return 'human-resources';
  if (pathname.startsWith('/sales/administrative')) return 'admin';
  if (pathname.startsWith('/sales/admin/')) return 'admin';
  return 'technology';
}

export function CreateTicketModal({
  salesUser,
  open,
  onClose,
  preferredCategory = null,
}: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>('technology');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [attachments, setAttachments] = useState<TicketAttachmentDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    revokeTicketAttachmentDrafts(attachments);
    setTitle('');
    setDescription('');
    setPriority('normal');
    setAttachments([]);
    setCategory(suggestCategory(location.pathname, preferredCategory));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when modal opens
  }, [open, location.pathname, preferredCategory]);

  if (!open) return null;

  const routingTeam = TICKET_CATEGORY_TEAM[category];

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const diagnostic = captureTicketDiagnosticContext(
        salesUser,
        location.pathname,
        location.search,
      );
      const pageSnapshot = await capturePortalPageSnapshot();
      const ticket = await createTicket({
        title,
        description,
        category,
        priority,
        createdBy: salesUser.id,
        diagnostic,
        pageSnapshot,
        attachments: attachments.map((a) => ({
          file: a.file,
          fileName: a.fileName,
          mimeType: a.mimeType,
        })),
        sourcePortal: 'tage',
        createdVia: 'portal_ui',
        syncStatus: 'local_only',
      });
      revokeTicketAttachmentDrafts(attachments);
      setAttachments([]);
      onClose();
      navigate(`/sales/tickets/${ticket.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create ticket');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal modal-wide"
        role="dialog"
        aria-labelledby="create-ticket-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 id="create-ticket-title">Create ticket</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Route to the right shared-services queue. A page snapshot and diagnostics
          are attached automatically. You can also paste screenshots or upload files.
        </p>
        <form onSubmit={(e) => void onSubmit(e)}>
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary"
              autoFocus
              required
            />
          </label>
          <label>
            Description
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What happened? What did you expect? Paste screenshots here too."
            />
          </label>
          <TicketAttachmentPicker
            files={attachments}
            onChange={setAttachments}
            disabled={saving}
            pasteTargetRef={descriptionRef}
            label="Files & screenshots"
          />
          <div className="form-row">
            <label>
              Queue
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
              >
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TICKET_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
              >
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {TICKET_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Routes to {routingTeam.label}.
          </p>
          {error ? <p className="error">{error}</p> : null}
          <div className="modal-actions">
            <Link to="/sales/tickets" className="btn ghost" onClick={onClose}>
              My tickets
            </Link>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create ticket'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
