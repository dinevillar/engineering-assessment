'use client';

import { useState } from 'react';
import { api, ApiError, type CaseView } from './api.ts';
import { OUTCOME_SHORT, stamp } from './format.ts';

const MIN_REASON = 15;

export function DecisionPanel({ view, disabled, onSaved, onReported, onReload }: {
  view: CaseView; disabled: boolean;
  onSaved: (v: CaseView) => void; onReported: (v: CaseView) => void; onReload: () => void;
}) {
  const ev = view.evaluation;
  const latest = view.latestDecision;
  const stale = view.status === 'needs_attention';
  const supported = ev.policy.action === 'expand_promotion' ? 'approve_expansion'
    : view.options.find(o => o.outcome === 'hold_pending_data')?.reason.startsWith('Recommended') ? 'hold_pending_data' : 'hold';

  const [editing, setEditing] = useState(!latest || stale);
  const [outcome, setOutcome] = useState<string>(latest && !stale ? latest.outcome : supported);
  const [reason, setReason] = useState('');
  const [reviewer, setReviewer] = useState(latest?.reviewer ?? '');
  const [ack, setAck] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'save' | 'report' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const reasonError = reason.trim().length < MIN_REASON ? `At least ${MIN_REASON} characters (${reason.trim().length}/${MIN_REASON}).` : null;
  const ackError = ev.limitations.length > 0 && !ack ? 'Confirm the limitations to save.' : null;
  const selected = view.options.find(o => o.outcome === outcome);

  const save = async () => {
    setTouched(true);
    setError(null);
    if (reasonError || ackError) return;
    setBusy('save');
    try {
      const next = await api.saveDecision(view.case.caseId, {
        outcome, reason, reviewer, acknowledgeLimitations: ack,
        evidenceFingerprint: ev.fingerprint, expectedVersion: latest?.version ?? 0,
      });
      onSaved(next);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError('UNKNOWN', String(e), 0));
    } finally { setBusy(null); }
  };

  const report = async () => {
    setError(null);
    setBusy('report');
    try { onReported(await api.generateReport(view.case.caseId)); }
    catch (e) { setError(e instanceof ApiError ? e : new ApiError('UNKNOWN', String(e), 0)); }
    finally { setBusy(null); }
  };

  const reloadable = error && ['EVIDENCE_CHANGED', 'VERSION_CONFLICT'].includes(error.code);

  return (
    <>
      <div className={`verdict ${ev.policy.action === 'expand_promotion' ? 'expand' : 'hold'}`}>
        <div className="label">Supported by the evidence</div>
        <div className="action">{ev.policy.action === 'expand_promotion' ? 'Expansion of 10% may be suggested' : 'Hold the promotion'}</div>
        <p className="muted" style={{ fontSize: 13 }}>{ev.policy.rationale}</p>
      </div>

      <section className="card" aria-labelledby="dec-h">
        <header>
          <h2 id="dec-h">Review decision</h2>
          {latest && <span className={`chip ${stale ? 'danger' : 'accent'}`}>v{latest.version}{stale ? ' · outdated' : ''}</span>}
        </header>
        <div className="body">
          {latest && !editing && (
            <>
              <dl className="kv">
                <dt>Decision</dt><dd><strong>{OUTCOME_SHORT[latest.outcome]}</strong>{latest.budgetChangePct ? ` (${latest.budgetChangePct}%)` : ''}</dd>
                <dt>Reason</dt><dd>{latest.reason}</dd>
                <dt>By</dt><dd>{latest.reviewer} · {stamp(latest.createdAt)}</dd>
              </dl>
              <div className="actions">
                <button className="btn small" onClick={() => { setEditing(true); setReason(''); setAck(false); setTouched(false); }} disabled={disabled}>Revise decision</button>
              </div>
            </>
          )}

          {editing && (
            <form onSubmit={e => { e.preventDefault(); void save(); }} noValidate>
              {stale && latest && <p className="hint" style={{ marginBottom: 8 }}>Decision v{latest.version} ({OUTCOME_SHORT[latest.outcome]}) was made on different evidence. Saving creates v{latest.version + 1}.</p>}
              <fieldset disabled={disabled || busy !== null}>
                <legend className="sr-only">Outcome</legend>
                {view.options.map(o => (
                  <label key={o.outcome} className={`option${outcome === o.outcome ? ' checked' : ''}${o.allowed ? '' : ' disabled'}`}>
                    <input type="radio" name="outcome" value={o.outcome} checked={outcome === o.outcome}
                      disabled={!o.allowed} onChange={() => setOutcome(o.outcome)} />
                    <span>
                      <span style={{ fontWeight: 600 }}>{o.label}</span>
                      {o.outcome === supported && <> <span className="chip ok">supported</span></>}
                      <span className="why" style={{ display: 'block' }}>{o.reason}</span>
                    </span>
                  </label>
                ))}

                <div className="field">
                  <label htmlFor="reason">Reason <span className="subtle">(saved with the decision and shown in the report)</span></label>
                  <textarea id="reason" value={reason} onChange={e => setReason(e.target.value)} onBlur={() => setTouched(true)}
                    aria-invalid={touched && !!reasonError} aria-describedby="reason-err"
                    placeholder={outcome === 'approve_expansion' ? 'e.g. Both complete weeks reconcile with the publisher; growth meets the threshold.' : 'e.g. Current week is partial; hold until the complete publisher report is available.'} />
                  {touched && reasonError && <span id="reason-err" className="field-error">{reasonError}</span>}
                </div>
                <div className="field">
                  <label htmlFor="reviewer">Reviewer</label>
                  <input id="reviewer" type="text" value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="Your name" />
                </div>

                {ev.limitations.length > 0 && (
                  <div className="field">
                    <span style={{ fontWeight: 600, fontSize: 13 }}>Limitations saved with this decision</span>
                    <ul className="limitations">{ev.limitations.map(l => <li key={l}>{l}</li>)}</ul>
                    <label className="check" style={{ marginTop: 6 }}>
                      <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                      <span>I have reviewed these limitations.</span>
                    </label>
                    {touched && ackError && <span className="field-error">{ackError}</span>}
                  </div>
                )}
              </fieldset>

              {error && busy === null && (
                <div className="banner danger" role="alert" style={{ marginTop: 12, marginBottom: 0, display: 'block' }}>
                  <strong>{error.code === 'UNSUPPORTED_APPROVAL' ? 'Approval rejected by the server' : 'Not saved'}</strong>
                  <p>{error.message}</p>
                  {error.details.map(d => <p key={d} className="subtle">{d}</p>)}
                  {reloadable && <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={onReload}>Reload evidence</button>}
                </div>
              )}

              <div className="actions">
                <button type="submit" className="btn primary" disabled={disabled || busy !== null || (selected && !selected.allowed)}>
                  {busy === 'save' ? <><span className="spinner" /> Saving…</> : latest ? `Save as v${latest.version + 1}` : 'Save decision'}
                </button>
                {latest && !stale && <button type="button" className="btn" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>}
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="rep-h">
        <header><h2 id="rep-h">Client report</h2>
          {view.reportCurrent && <span className="chip ok">up to date</span>}
        </header>
        <div className="body">
          <p className="muted" style={{ fontSize: 13 }}>
            {!latest ? 'Save a decision first. The report is generated from the saved decision and the evidence it was based on.'
              : stale ? 'Blocked: the evidence changed after the saved decision. Save a new decision to generate the report.'
              : view.reportCurrent ? `Generated from decision v${latest.version}. Regenerate only if you want a fresh copy.`
              : `Will be generated from decision v${latest.version} (${OUTCOME_SHORT[latest.outcome]}).`}
          </p>
          {error && !editing && (
            <div className="banner danger" role="alert" style={{ marginTop: 8, marginBottom: 0, display: 'block' }}>
              <strong>Report not generated</strong><p>{error.message}</p>
              {error.details.map(d => <p key={d} className="subtle">{d}</p>)}
            </div>
          )}
          <div className="actions">
            <button className="btn primary block" onClick={report} disabled={!latest || stale || disabled || busy !== null || editing}>
              {busy === 'report' ? <><span className="spinner" /> Generating…</> : view.reportCurrent ? 'Regenerate report' : 'Generate client report'}
            </button>
          </div>
          {editing && latest && !stale && <p className="hint" style={{ marginTop: 6 }}>Finish or cancel the revision first.</p>}
        </div>
      </section>
    </>
  );
}
