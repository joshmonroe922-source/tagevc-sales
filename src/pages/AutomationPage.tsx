import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDripEnrollments, listDripSequences, runDripsNow } from '../lib/api';
import { formatDateTime } from '../lib/types';

export function AutomationPage() {
  const [sequences, setSequences] = useState<any[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const [seqs, enrs] = await Promise.all([listDripSequences(), listDripEnrollments()]);
      setSequences(seqs);
      setEnrollments(enrs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load automation');
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onRun() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await runDripsNow();
      setMessage(
        `Processed ${result.processed} enrollment(s)${
          result.errors.length ? ` · ${result.errors.length} error(s)` : ''
        }`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Founder nurture</h1>
          <p className="muted">
            Sequences that nurture inbound founders and operators — reminders and follow-up tasks
            after website intake.
          </p>
        </div>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void onRun()}>
          {busy ? 'Running…' : 'Run due drips now'}
        </button>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {message ? <div className="banner ok">{message}</div> : null}

      <div className="detail-grid">
        <div className="panel">
          <h2>Sequences</h2>
          {sequences.map((seq) => (
            <div key={seq.id} className="seq-block">
              <div className="seq-head">
                <strong>{seq.name}</strong>
                <span className={`badge ${seq.active ? 'ok' : ''}`}>
                  {seq.active ? 'active' : 'inactive'}
                </span>
                <code className="muted small">{seq.slug}</code>
              </div>
              <p className="muted small">{seq.description}</p>
              <ol className="step-list">
                {(seq.sales_drip_steps ?? [])
                  .slice()
                  .sort((a: any, b: any) => a.step_order - b.step_order)
                  .map((step: any) => (
                    <li key={step.id}>
                      Day {step.delay_days}: {step.subject}{' '}
                      <span className="badge">{step.action_type}</span>
                    </li>
                  ))}
              </ol>
            </div>
          ))}
          {sequences.length === 0 ? <p className="muted">No sequences seeded yet.</p> : null}
        </div>

        <div className="panel">
          <h2>Enrollments</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Sequence</th>
                  <th>Status</th>
                  <th>Next</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.sales_leads ? (
                        <Link to={`/sales/leads/${e.sales_leads.id}`}>{e.sales_leads.name}</Link>
                      ) : (
                        e.lead_id
                      )}
                    </td>
                    <td>{e.sales_drip_sequences?.name ?? e.sequence_id}</td>
                    <td>{e.status}</td>
                    <td>{formatDateTime(e.next_send_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {enrollments.length === 0 ? (
            <p className="muted">
              No enrollments yet. Website intake enrolls new founder deals automatically.
            </p>
          ) : null}
        </div>
      </div>
    </>
  );
}
