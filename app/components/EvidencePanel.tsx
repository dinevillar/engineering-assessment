import type { CaseView } from './api.ts';
import { SEVERITY, day, growth, int, money, pct, range, stamp } from './format.ts';

type Evaluation = CaseView['evaluation'];
type Week = Evaluation['weeks'][number];

export function EvidencePanel({ evaluation: ev }: { evaluation: Evaluation }) {
  return (
    <>
      <FigureComparison ev={ev} />
      <Findings ev={ev} />
      <SourceReports ev={ev} />
      <ModelCheck ev={ev} />
      <Context ev={ev} />
    </>
  );
}

const fullWeek = (w: Week) => w.publisherStatus === 'complete' && (w.publisherPeriodEnd ?? '') >= w.expectedPeriodEnd;

function Coverage({ w }: { w: Week }) {
  if (w.publisher === null) return <span className="chip danger">Not in export</span>;
  return fullWeek(w)
    ? <span className="chip ok">Complete week</span>
    : <span className="chip danger">Partial · to {day(w.publisherPeriodEnd)}</span>;
}

function FigureComparison({ ev }: { ev: Evaluation }) {
  const [cur, prev] = ev.weeks;
  const pipelinePct = growth(cur.pipeline, prev.pipeline);
  const cell = (value: number | null, truth: number | null, note?: string) => (
    <td className="figure">
      <span className={`value${value !== null && truth !== null && value !== truth ? ' wrong' : ''}`}>{int(value)}</span>
      {value !== null && truth !== null && value !== truth && <span className="note">{value > truth ? '+' : ''}{int(value - truth)} vs publisher</span>}
      {note && <span className="note">{note}</span>}
    </td>
  );
  const rows = [cur, prev].map(w => (
    <tr key={w.week}>
      <th scope="row" style={{ color: 'var(--text)', fontSize: 13 }}>
        {w.week === 'current' ? 'Reporting week' : 'Comparison week'}
        <span className="note subtle" style={{ display: 'block', fontWeight: 400 }}>{range(w.periodStart, w.expectedPeriodEnd)}</span>
      </th>
      {cell(w.draft, w.publisher, w.draftReportIds.length > 1 ? `${w.draftReportIds.length} reports summed` : undefined)}
      {cell(w.pipeline, w.publisher)}
      <td className="figure authoritative">
        <span className="value">{int(w.publisher)}</span>
        <span className="note" style={{ marginTop: 4 }}><Coverage w={w} /></span>
        {w.publisherReportId && <span className="note mono">{w.publisherReportId}</span>}
      </td>
    </tr>
  ));
  return (
    <section className="card" aria-labelledby="cmp-h">
      <header>
        <div>
          <h2 id="cmp-h">Active subscriptions: draft vs. sources</h2>
          <p className="section-intro">Red, struck-through figures disagree with the publisher&apos;s own report, which is authoritative.</p>
        </div>
      </header>
      <div className="body table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Measure</span></th>
              <th scope="col">Draft report<br /><span style={{ fontWeight: 400 }}>original pipeline</span></th>
              <th scope="col">Internal pipeline<br /><span style={{ fontWeight: 400 }}>corrected selection</span></th>
              <th scope="col" className="authoritative">Publisher export<br /><span style={{ fontWeight: 400 }}>authoritative</span></th>
            </tr>
          </thead>
          <tbody>
            {rows}
            <tr>
              <th scope="row" style={{ color: 'var(--text)', fontSize: 13 }}>Week-over-week change</th>
              <td className="figure">
                <span className={`value${ev.growth.draftPct !== null && ev.growth.draftPct !== ev.growth.verifiedPct ? ' wrong' : ''}`}>{pct(ev.growth.draftPct)}</span>
                {ev.growth.draftPct !== null && !ev.growth.comparable && <span className="note">claimed as growth</span>}
              </td>
              <td className="figure">
                <span className="value">{pct(pipelinePct)}</span>
                {pipelinePct !== null && !ev.growth.comparable && <span className="note">raw difference, not comparable</span>}
              </td>
              <td className="figure authoritative">
                {ev.growth.comparable
                  ? <><span className="value">{pct(ev.growth.verifiedPct)}</span><span className="note">Comparable: both weeks complete</span></>
                  : <><span className="value">Not comparable</span>
                    <span className="note">{ev.growth.observedPct !== null ? `Raw difference ${pct(ev.growth.observedPct)} is not weekly growth` : 'A publisher figure is missing'}</span></>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Findings({ ev }: { ev: Evaluation }) {
  const order = { blocking: 0, corrected: 1, warning: 2 } as const;
  const issues = [...ev.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = (s: keyof typeof order) => issues.filter(i => i.severity === s).length;
  return (
    <section className="card" aria-labelledby="find-h">
      <header>
        <div>
          <h2 id="find-h">Findings</h2>
          <p className="section-intro">
            <strong>Blocking</strong> findings prevent a growth claim. <strong>Corrected</strong> ones were resolved using the publisher export but must be fixed upstream.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {counts('blocking') > 0 && <span className="chip danger">{counts('blocking')} blocking</span>}
          {counts('corrected') > 0 && <span className="chip warn">{counts('corrected')} corrected</span>}
        </div>
      </header>
      <div className="body">
        {issues.length === 0
          ? <div className="banner info" style={{ marginBottom: 0 }}><div><strong>No inconsistencies detected</strong><p className="muted">Both weeks are complete, the pipeline matches the publisher export, and the draft figures agree.</p></div></div>
          : (
            <ul className="findings">
              {issues.map((i, n) => (
                <li key={`${i.code}-${i.week}-${n}`} className={`finding ${i.severity}`}>
                  <div><span className={`chip ${SEVERITY[i.severity].tone}`}>{SEVERITY[i.severity].label}</span></div>
                  <div>
                    <p>{i.message}</p>
                    {i.sourceIds.length > 0 && <div className="ids">{[...new Set(i.sourceIds)].map(id => <span key={id} className="chip mono">{id}</span>)}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
    </section>
  );
}

function SourceReports({ ev }: { ev: Evaluation }) {
  return (
    <section className="card" aria-labelledby="src-h">
      <header><h2 id="src-h">Source reports</h2></header>
      <div className="body">
        <p className="section-intro" style={{ marginBottom: 8 }}>Every imported report available by the as-of time. The highlighted row is the one the corrected pipeline uses; the publisher columns come from the export.</p>
        {(['current', 'previous'] as const).map(week => {
          const rows = ev.sources.filter(s => s.week === week);
          const pub = ev.publisherCurrent.find(p => p.week === week);
          const w = ev.weeks.find(x => x.week === week)!;
          return (
            <details key={week} open={week === 'current'} style={{ marginTop: 8 }}>
              <summary>{week === 'current' ? 'Reporting week' : 'Comparison week'} · {range(w.periodStart, w.expectedPeriodEnd)} <span className="subtle">({rows.length} imports{pub ? `, publisher current: ${pub.publisherReportId}` : ', no publisher report'})</span></summary>
              {rows.length === 0 ? <p className="subtle" style={{ padding: 8 }}>No imported reports for this week.</p> : (
                <div className="table-wrap">
                  <table className="compact">
                    <thead>
                      <tr><th>Import</th><th>Publisher report</th><th>Status</th><th>Covers to</th><th>Generated</th><th>Loaded</th><th>Header</th><th>Publisher</th></tr>
                    </thead>
                    <tbody>
                      {rows.map(s => {
                        const superseded = s.exported?.supersededBy;
                        const loadedOk = s.exported ? s.activeSubscriptions === s.exported.offerSum && s.loadedOffers === s.exported.offerCount : false;
                        return (
                          <tr key={s.reportId} className={s.selected ? 'selected' : ''}>
                            <td className="mono">{s.reportId}{s.selected && <> <span className="chip accent">used</span></>}</td>
                            <td className="mono">{s.publisherReportId}{superseded ? <span className="subtle" style={{ display: 'block' }}>superseded by {superseded}</span> : s.exported ? null : <span className="chip danger">not in export</span>}</td>
                            <td>{s.status}</td>
                            <td className="num">{day(s.periodEnd)}</td>
                            <td className="num">{stamp(s.generatedAt)}</td>
                            <td className="num">{int(s.activeSubscriptions)} <span className="subtle">/ {s.loadedOffers} offers</span></td>
                            <td className="num">{int(s.declaredSubscriptions)}</td>
                            <td className="num">{s.exported ? <>{int(s.exported.offerSum)} {loadedOk ? <span className="chip ok">match</span> : <span className="chip danger">differs</span>}</> : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}

function ModelCheck({ ev }: { ev: Evaluation }) {
  const p = ev.model.proposal;
  return (
    <section className="card" aria-labelledby="model-h">
      <header>
        <h2 id="model-h">AI commentary check</h2>
        <span className={`chip ${ev.model.accepted ? 'ok' : 'danger'}`}>{ev.model.accepted ? 'Consistent with policy' : 'Rejected'}</span>
      </header>
      <div className="body">
        <p className="muted" style={{ marginBottom: 8 }}>The model draft is treated as a suggestion. Operational notes are context only and cannot change the promotion policy.</p>
        <blockquote style={{ margin: 0, padding: '8px 12px', borderLeft: '3px solid var(--border-strong)', background: 'var(--surface-2)', borderRadius: 4 }}>
          “{p.narrative}”
          <div className="subtle" style={{ marginTop: 4 }}>Proposed: {p.action === 'expand_promotion' ? `expand promotion ${p.budgetChangePct}%` : 'hold'} · notes retrieved: {ev.model.documents.map(d => d.id).join(', ') || 'none'}</div>
        </blockquote>
        {ev.model.problems.length > 0 && (
          <ul className="limitations" style={{ marginTop: 8 }}>
            {ev.model.problems.map(x => <li key={x}>{x}</li>)}
          </ul>
        )}
      </div>
    </section>
  );
}

function Context({ ev }: { ev: Evaluation }) {
  const c = ev.context;
  return (
    <section className="card" aria-labelledby="ctx-h">
      <header><h2 id="ctx-h">Supporting context</h2><span className="subtle">Not used by the promotion policy</span></header>
      <div className="body stats">
        <div className="stat"><div className="k">Net sales, reporting week</div><div className="v">{money(c.netSales)}</div></div>
        <div className="stat"><div className="k">Ad spend</div><div className="v">{money(c.adSpend)}</div></div>
        <div className="stat"><div className="k">Attributed ROAS</div><div className="v">{c.roas === null ? 'Undefined' : c.roas.toFixed(2)}</div></div>
        <div className="stat"><div className="k">Inventory units</div><div className="v">{int(c.inventoryUnits)}</div></div>
      </div>
    </section>
  );
}
