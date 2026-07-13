import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { listLeads } from '../lib/api';
import { createEntity, listChecklistTemplates } from '../lib/opsApi';
import type { OpsChecklistTemplate, OpsEntityType } from '../lib/opsTypes';
import {
  OPS_ENTITY_TYPES,
  OPS_ENTITY_TYPE_LABELS,
} from '../lib/opsTypes';
import { getPortalDefinition } from '../lib/portals';
import type { SalesLead, SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function EntityNewPage({ salesUser }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateFromQuery = searchParams.get('template')?.trim() || '';
  const fromSlug = searchParams.get('from')?.trim() || '';
  const fromPortal = fromSlug ? getPortalDefinition(fromSlug) : undefined;

  const [templates, setTemplates] = useState<OpsChecklistTemplate[]>([]);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [name, setName] = useState('');
  const [templateSlug, setTemplateSlug] = useState<string>(
    templateFromQuery || 'start-business',
  );
  const [entityType, setEntityType] = useState<OpsEntityType | ''>('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [leadId, setLeadId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [tpls, dealList] = await Promise.all([
          listChecklistTemplates(),
          listLeads(),
        ]);
        setTemplates(tpls);
        setLeads(dealList);

        const preferred =
          (templateFromQuery && tpls.some((t) => t.slug === templateFromQuery)
            ? templateFromQuery
            : null) ||
          (tpls.some((t) => t.slug === 'start-business') ? 'start-business' : null) ||
          tpls[0]?.slug ||
          '';
        setTemplateSlug(preferred);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load form');
      }
    })();
  }, [templateFromQuery]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const entity = await createEntity({
        name: name.trim(),
        template_slug: templateSlug || null,
        entity_type: entityType || undefined,
        jurisdiction: jurisdiction.trim(),
        lead_id: leadId || null,
        notes: notes.trim(),
        created_by: salesUser.id,
      });
      navigate(`/sales/ops/entities/${entity.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      setSaving(false);
    }
  }

  const backTo = fromPortal?.homePath ?? '/sales/ops';
  const backLabel = fromPortal?.name ?? 'Entity Ops';
  const title =
    templateSlug === 'acquire-business'
      ? 'Acquire a business'
      : templateSlug === 'start-business'
        ? 'Start a business'
        : 'New entity';

  return (
    <>
      <div className="page-header">
        <div>
          <p className="crumb">
            <Link to={backTo}>{backLabel}</Link> / New
          </p>
          <h1>{title}</h1>
          <p className="muted">
            Clone a start or acquire checklist, seed document folders, optionally link a
            deal.
          </p>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <form className="panel form-stack" onSubmit={onSubmit}>
        <label>
          <span>Entity name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Acme Holdings LLC"
            required
          />
        </label>

        <label>
          <span>Checklist template</span>
          <select
            value={templateSlug}
            onChange={(e) => setTemplateSlug(e.target.value)}
          >
            <option value="">None (empty checklist)</option>
            {templates.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
          {templateSlug ? (
            <span className="muted small">
              {templates.find((t) => t.slug === templateSlug)?.description}
            </span>
          ) : null}
        </label>

        <label>
          <span>Entity type (optional override)</span>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value as OpsEntityType | '')}
          >
            <option value="">Use template default</option>
            {OPS_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {OPS_ENTITY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Jurisdiction</span>
          <input
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            placeholder="e.g. Delaware"
          />
        </label>

        <label>
          <span>Link to deal (optional)</span>
          <select value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">— None —</option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.name}
                {lead.company ? ` · ${lead.company}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Context, ownership, thesis…"
          />
        </label>

        <div className="form-actions">
          <Link to={backTo} className="btn ghost">
            Cancel
          </Link>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Creating…' : 'Create entity'}
          </button>
        </div>
      </form>
    </>
  );
}
