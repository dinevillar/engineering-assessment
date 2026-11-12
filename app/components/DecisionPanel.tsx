'use client';

import { useState } from 'react';
import { api, ApiError, type CaseView } from './api.ts';
import { OUTCOME_SHORT, stamp } from './format.ts';
import { IconAlert, IconBlock, IconCheckCircle, IconFile, IconRefresh, IconShield } from './icons.tsx';

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

  const reasonLen = reason.trim().length;
  const reasonError = reasonLen < MIN_REASON ? `Write at least ${MIN_REASON} characters (${reasonLen}/${MIN_REASON}).` : null;
  const ackError = ev.limitations.length > 0 && !ack ? 'Confirm the limitations to save.' : null;
  const selected = view.options.find(o => o.outcome === outcome);

  const save = async () => {
    setTouched(true);
    setError(null);
    if (reasonError || ackError) return;
    setBusy('save');
    try {
      onSaved(await api.saveDecision(view.case.caseId, {
        outcome, reason, reviewer, acknowledgeLimitations: ack,
        evidenceFingerprint: ev.fingerprint, expectedVersion: latest?.version ?? 0,
      }));
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
  const expand = ev.policy.action === 'expand_promotion';

  return (
    <>
      <div className={`verdict ${expand ? 'expand' : 'hold'}`}>
        <div className="eyebrow">Supported by the evidence</div>
        <div className="action">{expand ? <IconCheckCircle size={20} /> : <IconShield size={20} />}{expand ? 'A 10% expansion may be suggested' : 'Hold the promotion'}</div>
        <p>{ev.policy.rationale}</p>
      </div>

      <section className="card" aria-labelledby="dec-h">
        <header>
          <div>
            <h2 id="dec-h">Review decision</h2>
            <p className="section-intro">Validated and stored by the server with its evidence.</p>
          </div>
          {latest && <span className={`chip ${stale ? 'danger' : 'accent'}`}>v{latest.version}{stale ? ' · outdated' : ''}</span>}
        </header>
        <div className="body">
          {latest && !editing && (
            <>
              <dl className="kv">
                <dt>Decision</dt><dd><strong>{OUTCOME_SHORT[latest.outcome]}</strong>{latest.budgetChangePct ? ` (${latest.budgetChangePct}%)` : ''}</dd>
                <dt>Reason</dt><dd>{latest.reason}</dd>
                <dt>Reviewer</dt><dd>{latest.reviewer}</dd>
                <dt>Saved</dt><dd>{stamp(latest.createdAt)}</dd>
              </dl>
              <div className="actions">
                <button className="btn small" onClick={() => { setEditing(true); setReason(''); setAck(false); setTouched(false); setError(null); }} disabled={disabled}>Revise decision</button>
              </div>
            </>
          )}

          {editing && (
            <form onSubmit={e => { e.preventDefault(); void save(); }} noValidate>
              {stale && latest && (
                <div className="banner warn" style={{ marginBottom: 14 }}>
                  <IconAlert size={16} />
                  <div className="grow"><p style={{ fontSize: 12.5 }}>Decision v{latest.version} ({OUTCOME_SHORT[latest.outcome]}) was made on different evidence. Saving creates v{latest.version + 1}.</p></div>
                </div>
              )}
              <fieldset disabled={disabled || busy !== null}>
                <legend className="eyebrow" style={{ marginBottom: 8 }}>Outcome</legend>
                <div className="options">
                  {view.options.map(o => (
                    <label key={o.outcome} className={`option${outcome === o.outcome ? ' checked' : ''}${o.allowed ? '' : ' disabled'}`}>
                      <input type="radio" name="outcome" value={o.outcome} checked={outcome === o.outcome}
                        disabled={!o.allowed} onChange={() => setOutcome(o.outcome)} />
                      <span style={{ minWidth: 0 }}>
                        <span className="title">{o.label}{o.outcome === supported && <span className="chip ok">Supported</span>}</span>
                        <span className="why">{!o.allowed && <IconBlock size={12} />}<span>{o.reason}</span></span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="field">
                  <label htmlFor="reason">Reason <span className="opt">· shown in the client report</span></label>
                  <textarea id="reason" value={reason} onChange={e => setReason(e.target.value)} onBlur={() => setTouched(true)}
                    aria-invalid={touched && !!reasonError} aria-describedby="reason-help"
                    placeholder={outcome === 'approve_expansion' ? 'e.g. Both complete weeks reconcile with the publisher; growth meets the threshold.' : 'e.g. Current week is partial; hold until the complete publisher report is available.'} />
                  <span id="reason-help" className={touched && reasonError ? 'field-error' : 'hint'}>
                    {touched && reasonError ? <><IconAlert size={12} /> {reasonError}</> : `${reasonLen} characters · minimum ${MIN_REASON}`}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="reviewer">Reviewer <span className="opt">· optional</span></label>
                  <input id="reviewer" type="text" value={reviewer} onChange={e => setReviewer(e.target.value)} placeholder="Your name" autoComplete="name" />
                </div>

                {ev.limitations.length > 0 && (
                  <div className="field">
                    <span className="label">Limitations saved with this decision</span>
                    <ul className="limitations">{ev.limitations.map(l => <li key={l}>{l}</li>)}</ul>
                    <label className="check" style={{ marginTop: 4 }}>
                      <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                      <span>I have reviewed these limitations.</span>
                    </label>
                    {touched && ackError && <span className="field-error"><IconAlert size={12} /> {ackError}</span>}
                  </div>
                )}
              </fieldset>

              {error && busy === null && (
                <div className="banner danger compact" role="alert">
                  <IconBlock size={16} />
                  <div className="grow">
                    <strong>{error.code === 'UNSUPPORTED_APPROVAL' ? 'Approval rejected by the server' : 'Decision not saved'}</strong>
                    <p style={{ fontSize: 13 }}>{error.message}</p>
                    {error.details.map(d => <p key={d} className="subtle">{d}</p>)}
                    {reloadable && <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={onReload}><IconRefresh size={14} /> Reload evidence</button>}
                  </div>
                </div>
              )}

              <div className="actions">
                <button type="submit" className="btn primary" style={{ flex: 1 }} disabled={disabled || busy !== null || (selected && !selected.allowed)}>
                  {busy === 'save' ? <><span className="spinner" /> Saving…</> : latest ? `Save as v${latest.version + 1}` : 'Save decision'}
                </button>
                {latest && !stale && <button type="button" className="btn" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>}
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="rep-h">
        <header>
          <div className="title"><IconFile size={16} /><h2 id="rep-h">Client report</h2></div>
          {view.reportCurrent ? <span className="chip ok">Up to date</span> : view.latestReport ? <span className="chip danger">Outdated</span> : null}
        </header>
        <div className="body">
          <p className="muted" style={{ fontSize: 13 }}>
            {!latest ? 'Save a decision first. The report is generated from the saved decision and the evidence it was based on.'
              : stale ? 'Blocked: the evidence changed after the saved decision. Save a new decision to generate the report.'
              : view.reportCurrent ? `Generated from decision v${latest.version}. Regenerate only if you need a fresh copy.`
              : `Will be generated from decision v${latest.version} (${OUTCOME_SHORT[latest.outcome]}).`}
          </p>
          {error && !editing && (
            <div className="banner danger compact" role="alert">
              <IconBlock size={16} />
              <div className="grow"><strong>Report not generated</strong><p style={{ fontSize: 13 }}>{error.message}</p>
                {error.details.map(d => <p key={d} className="subtle">{d}</p>)}</div>
            </div>
          )}
          <div className="actions">
            <button className={`btn block ${view.reportCurrent ? '' : 'primary'}`} onClick={report} disabled={!latest || stale || disabled || busy !== null || editing}>
              {busy === 'report' ? <><span className="spinner" /> Generating…</> : view.reportCurrent ? <><IconRefresh size={14} /> Regenerate report</> : <><IconFile size={14} /> Generate client report</>}
            </button>
          </div>
          {editing && latest && !stale && <p className="hint" style={{ marginTop: 8 }}>Finish or cancel the revision first.</p>}
        </div>
      </section>
    </>
  );
}
