import type { CaseView } from './api.ts';
import { OUTCOME_SHORT, stamp } from './format.ts';

const EVENT_LABEL: Record<string, string> = {
  case_opened: 'Case opened', decision_saved: 'Decision saved', decision_rejected: 'Decision rejected by server',
  report_generated: 'Client report generated', report_blocked: 'Report blocked (evidence changed)',
};

export function HistoryPanel({ view }: { view: CaseView }) {
  return (
    <>
      <section className="card" aria-labelledby="dh">
        <header><h2 id="dh">Decision versions</h2></header>
        <div className="body">
          {view.decisions.length === 0 ? <p className="muted">No decision saved yet.</p> : (
            <ul className="history">
              {view.decisions.map(d => {
                const snap = d.evidence as { calculation?: string; sourceIds?: string[]; limitations?: string[] };
                const current = d.evidenceFingerprint === view.evaluation.fingerprint;
                return (
                  <li key={d.decisionId}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>v{d.version} · {OUTCOME_SHORT[d.outcome]}</strong>
                      <span className={`chip ${current ? 'ok' : ''}`}>{current ? 'matches current evidence' : 'earlier evidence'}</span>
                      <span className="subtle">{d.reviewer} · {stamp(d.createdAt)}</span>
                    </div>
                    <p style={{ marginTop: 4 }}>{d.reason}</p>
                    <details style={{ marginTop: 4 }}>
                      <summary className="subtle">Saved evidence</summary>
                      <dl className="kv" style={{ marginTop: 6 }}>
                        <dt>Calculation</dt><dd className="num">{snap.calculation}</dd>
                        <dt>Sources</dt><dd className="mono">{snap.sourceIds?.join(', ')}</dd>
                        <dt>Evidence</dt><dd className="mono">{d.evidenceFingerprint}</dd>
                        <dt>Limitations</dt><dd><ul className="limitations" style={{ marginTop: 0 }}>{snap.limitations?.map(l => <li key={l}>{l}</li>)}</ul></dd>
                      </dl>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
      <section className="card" aria-labelledby="ah">
        <header><h2 id="ah">Audit trail</h2><span className="subtle">latest 20</span></header>
        <div className="body">
          <ul className="history">
            {view.events.map((e, i) => {
              const d = e.detail as { code?: string; outcome?: string; version?: number };
              return (
                <li key={i}>
                  <strong>{EVENT_LABEL[e.kind] ?? e.kind}</strong> <span className="subtle">{stamp(e.at)}</span>
                  {(d.code || d.outcome) && <div className="subtle">{[d.version && `v${d.version}`, d.outcome && OUTCOME_SHORT[d.outcome], d.code].filter(Boolean).join(' · ')}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </>
  );
}
