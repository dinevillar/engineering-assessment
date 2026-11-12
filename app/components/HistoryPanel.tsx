import type { CaseView } from './api.ts';
import { OUTCOME_SHORT, stamp } from './format.ts';
import { IconChevron, IconClock, IconFile } from './icons.tsx';

const EVENT_LABEL: Record<string, { label: string; tone: string }> = {
  case_opened: { label: 'Case opened', tone: '' },
  decision_saved: { label: 'Decision saved', tone: 'accent' },
  decision_rejected: { label: 'Decision rejected by server', tone: 'danger' },
  report_generated: { label: 'Client report generated', tone: 'ok' },
  report_blocked: { label: 'Report blocked: evidence changed', tone: 'danger' },
};

export function HistoryPanel({ view }: { view: CaseView }) {
  return (
    <>
      <section className="card" aria-labelledby="dh">
        <header>
          <div>
            <div className="title"><IconFile size={16} /><h2 id="dh">Decision versions</h2></div>
            <p className="section-intro">Append-only. Each version stores the evidence it was based on.</p>
          </div>
        </header>
        <div className="body">
          {view.decisions.length === 0 ? <p className="muted">No decision saved yet.</p> : (
            <ul className="timeline">
              {view.decisions.map(d => {
                const snap = d.evidence as { calculation?: string; sourceIds?: string[]; limitations?: string[] };
                const current = d.evidenceFingerprint === view.evaluation.fingerprint;
                return (
                  <li key={d.decisionId} className={current ? 'ok' : ''}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>v{d.version} · {OUTCOME_SHORT[d.outcome]}</strong>
                      <span className={`chip ${current ? 'ok' : ''}`}>{current ? 'Matches current evidence' : 'Earlier evidence'}</span>
                      <span className="subtle">{d.reviewer} · {stamp(d.createdAt)}</span>
                    </div>
                    <p style={{ marginTop: 4 }} className="muted">{d.reason}</p>
                    <details style={{ marginTop: 2 }}>
                      <summary className="subtle" style={{ fontWeight: 500, padding: '6px 0' }}><IconChevron size={12} className="chev" /> Saved evidence</summary>
                      <dl className="kv" style={{ margin: '4px 0 6px' }}>
                        <dt>Calculation</dt><dd className="num">{snap.calculation}</dd>
                        <dt>Sources</dt><dd>{snap.sourceIds?.map(id => <span key={id} className="chip id" style={{ margin: '0 4px 4px 0' }}>{id}</span>)}</dd>
                        <dt>Evidence</dt><dd className="mono">{d.evidenceFingerprint}</dd>
                        <dt>Limitations</dt><dd><ul className="limitations plain">{snap.limitations?.map(l => <li key={l}>{l}</li>)}</ul></dd>
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
        <header>
          <div className="title"><IconClock size={16} /><h2 id="ah">Audit trail</h2></div>
          <span className="subtle">Latest 20 events</span>
        </header>
        <div className="body">
          <ul className="timeline">
            {view.events.map((e, i) => {
              const d = e.detail as { code?: string; outcome?: string; version?: number };
              const meta = EVENT_LABEL[e.kind] ?? { label: e.kind, tone: '' };
              return (
                <li key={i} className={meta.tone}>
                  <strong style={{ fontWeight: 600 }}>{meta.label}</strong> <span className="subtle">· {stamp(e.at)}</span>
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
