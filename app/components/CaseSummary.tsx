import type { CaseView } from './api.ts';
import { OUTCOME_SHORT, day, int, pct } from './format.ts';
import { IconAlert, IconBlock, IconCheck, IconDatabase, IconShield } from './icons.tsx';

/** Three-step progress: Investigate → Decide → Report, derived from backend case status. */
export function Stepper({ view }: { view: CaseView }) {
  const decided = view.status === 'decided' || view.status === 'reported';
  const attention = view.status === 'needs_attention';
  const steps = [
    { t: 'Investigate evidence', d: `${view.evaluation.issues.length} finding${view.evaluation.issues.length === 1 ? '' : 's'} · ${view.evaluation.sources.length} source reports`,
      state: 'done' },
    { t: 'Save decision', d: attention ? `v${view.latestDecision?.version} outdated — re-decide` : view.latestDecision ? `v${view.latestDecision.version} · ${OUTCOME_SHORT[view.latestDecision.outcome]}` : 'Choose an outcome and reason',
      state: attention ? 'attention' : decided ? 'done' : 'current' },
    { t: 'Generate client report', d: view.reportCurrent ? 'Up to date' : attention ? 'Blocked until re-decided' : decided ? 'Ready to generate' : 'Needs a saved decision',
      state: view.reportCurrent ? 'done' : decided ? 'current' : 'todo' },
  ];
  return (
    <ol className="stepper" aria-label="Review progress" style={{ listStyle: 'none', padding: 0 }}>
      {steps.map((s, i) => (
        <li key={s.t} className={`step ${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="n">{s.state === 'done' ? <IconCheck size={14} strokeWidth={3} /> : s.state === 'attention' ? '!' : i + 1}</span>
          <span style={{ minWidth: 0 }}>
            <span className="t" style={{ display: 'block' }}>{s.t}</span>
            <span className="d" style={{ display: 'block' }}>{s.d}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Headline numbers a reviewer needs before reading details. */
export function KpiStrip({ view }: { view: CaseView }) {
  const ev = view.evaluation;
  const [cur] = ev.weeks;
  const full = cur.publisherStatus === 'complete' && (cur.publisherPeriodEnd ?? '') >= cur.expectedPeriodEnd;
  const drift = cur.draft !== null && cur.publisher !== null ? cur.draft - cur.publisher : null;
  const blocking = ev.issues.filter(i => i.severity === 'blocking').length;
  const corrected = ev.issues.filter(i => i.severity === 'corrected').length;
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="k"><IconDatabase size={14} /> Verified active subscriptions</div>
        <div className="v">{int(cur.publisher)}</div>
        <div className="s">{cur.publisher === null ? <span className="chip danger">Not in publisher export</span>
          : full ? <span className="chip ok">Complete week</span> : <span className="chip danger">Partial · to {day(cur.publisherPeriodEnd)}</span>}</div>
      </div>
      <div className={`kpi${ev.growth.comparable ? '' : ''}`}>
        <div className="k">Week-over-week change</div>
        <div className={`v${ev.growth.comparable ? '' : ' small'}`}>{ev.growth.comparable ? pct(ev.growth.verifiedPct) : 'Not comparable'}</div>
        <div className="s">{ev.growth.comparable ? 'Both weeks complete and verified' : ev.growth.observedPct !== null ? `Raw difference ${pct(ev.growth.observedPct)}` : 'A weekly figure is missing'}</div>
      </div>
      <div className={`kpi${drift ? ' danger' : ' ok'}`}>
        <div className="k">Draft vs. publisher</div>
        <div className="v">{drift === null ? '—' : drift === 0 ? 'Match' : `${drift > 0 ? '+' : ''}${int(drift)}`}</div>
        <div className="s">{drift ? `Draft showed ${int(cur.draft)}${ev.growth.draftPct !== null ? ` · ${pct(ev.growth.draftPct)}` : ''}` : 'Draft figure agrees with the source'}</div>
      </div>
      <div className={`kpi${blocking ? ' danger' : ''}`}>
        <div className="k">{blocking ? <IconBlock size={14} /> : corrected ? <IconAlert size={14} /> : <IconShield size={14} />} Evidence status</div>
        <div className="v small">{blocking ? `${blocking} blocking` : corrected ? `${corrected} corrected` : 'Clean'}</div>
        <div className="s">{blocking ? 'No growth claim can be made' : corrected ? 'Resolved via publisher export' : 'No inconsistencies detected'}
          {blocking > 0 && corrected > 0 && <span className="chip warn">{corrected} corrected</span>}</div>
      </div>
    </div>
  );
}
