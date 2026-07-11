import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { listLeads } from '../lib/api';
import { createEntity, listChecklistTemplates } from '../lib/opsApi';
import type { OpsChecklistTemplate, OpsEntityType } from '../lib/opsTypes';
import {
  OPS_ENTITY_TYPES,
  OPS_ENTITY_TYPE_LABELS,
} from '../lib/opsTypes';
import type { SalesLead, SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function EntityNewPage({ salesUser }: Props) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<OpsChecklistTemplate[]>([]);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [name, setName] = useState('');
  const [templateSlug, setTemplateSlug] = useState<string>('start-business');
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
        if (tpls.some((t) => t.slug === 'start-business')) {
          setTemplateSlug('start-business');
        } else if (tpls[0]) {
          setTemplateSlug(tpls[0].slug);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load form');
      }
    })();
  }, []);

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

  return (
    <>
      <div className="page-header">
        <div>
          <p className="crumb">
            <Link to="/sales/ops">Entity Ops</Link> / New
          </p>
          <h1>New entity</h1>
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
          <Link to="/sales/ops" className="btn ghost">
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
