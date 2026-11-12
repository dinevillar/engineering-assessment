import type { CaseView } from './api.ts';
import { SEVERITY, day, growth, int, money, pct, range, stamp } from './format.ts';
import { IconAlert, IconBlock, IconCheckCircle, IconChevron, IconDatabase, IconInfo, IconSparkle, IconWrench } from './icons.tsx';

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
  const cell = (value: number | null, truth: number | null, note?: string) => {
    const wrong = value !== null && truth !== null && value !== truth;
    return (
      <td className="figure">
        <span className={`value${wrong ? ' wrong' : ''}`}>{int(value)}</span>
        {wrong && <span className="note bad">{value! > truth! ? '+' : ''}{int(value! - truth!)} vs. publisher</span>}
        {note && <span className="note">{note}</span>}
      </td>
    );
  };
  return (
    <section className="card" aria-labelledby="cmp-h">
      <header>
        <div>
          <div className="title"><IconDatabase size={16} /><h2 id="cmp-h">Active subscriptions: draft vs. sources</h2></div>
          <p className="section-intro">Struck-through figures disagree with the publisher&apos;s own report, which is authoritative.</p>
        </div>
      </header>
      <div className="body flush table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" style={{ width: '24%' }}><span className="sr-only">Measure</span></th>
              <th scope="col">Draft report<span className="sub">original pipeline</span></th>
              <th scope="col">Internal pipeline<span className="sub">corrected selection</span></th>
              <th scope="col" className="authoritative">Publisher export<span className="sub">authoritative</span></th>
            </tr>
          </thead>
          <tbody>
            {[cur, prev].map(w => (
              <tr key={w.week}>
                <th scope="row">{w.week === 'current' ? 'Reporting week' : 'Comparison week'}<span className="sub">{range(w.periodStart, w.expectedPeriodEnd)}</span></th>
                {cell(w.draft, w.publisher, w.draftReportIds.length > 1 ? `${w.draftReportIds.length} reports summed` : undefined)}
                {cell(w.pipeline, w.publisher)}
                <td className="figure authoritative">
                  <span className="value">{int(w.publisher)}</span>
                  <span className="note" style={{ marginTop: 6 }}><Coverage w={w} /></span>
                  {w.publisherReportId && <span className="note mono">{w.publisherReportId}</span>}
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row">Week-over-week change</th>
              <td className="figure">
                <span className={`value${ev.growth.draftPct !== null && ev.growth.draftPct !== ev.growth.verifiedPct ? ' wrong' : ''}`}>{pct(ev.growth.draftPct)}</span>
                {ev.growth.draftPct !== null && !ev.growth.comparable && <span className="note bad">claimed as growth</span>}
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

const SEVERITY_ICON = { blocking: IconBlock, corrected: IconWrench, warning: IconInfo } as const;
const SEVERITY_HELP = {
  blocking: 'Prevents a growth claim',
  corrected: 'Resolved with the publisher export; fix upstream',
  warning: 'Informational',
} as const;

function Findings({ ev }: { ev: Evaluation }) {
  const order = { blocking: 0, corrected: 1, warning: 2 } as const;
  const issues = [...ev.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = (s: keyof typeof order) => issues.filter(i => i.severity === s).length;
  return (
    <section className="card" aria-labelledby="find-h">
      <header>
        <div>
          <div className="title"><IconAlert size={16} /><h2 id="find-h">Findings</h2></div>
          <p className="section-intro">Detected by reconciling the internal pipeline and the draft against the publisher export.</p>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {counts('blocking') > 0 && <span className="chip danger">{counts('blocking')} blocking</span>}
          {counts('corrected') > 0 && <span className="chip warn">{counts('corrected')} corrected</span>}
          {counts('warning') > 0 && <span className="chip">{counts('warning')} warning</span>}
        </div>
      </header>
      <div className="body">
        {issues.length === 0
          ? <div className="banner ok" style={{ marginBottom: 0 }}><IconCheckCircle size={18} /><div className="grow"><strong>No inconsistencies detected</strong><p className="muted">Both weeks are complete, the pipeline matches the publisher export, and the draft figures agree.</p></div></div>
          : (
            <ul className="findings">
              {issues.map((i, n) => {
                const Icon = SEVERITY_ICON[i.severity];
                return (
                  <li key={`${i.code}-${i.week}-${n}`} className={`finding ${i.severity}`}>
                    <Icon size={18} className="ico" />
                    <div style={{ minWidth: 0 }}>
                      <div className="head">
                        <span className="kind">{SEVERITY[i.severity].label}</span>
                        <span className="subtle">{SEVERITY_HELP[i.severity]}</span>
                      </div>
                      <p>{i.message}</p>
                      {i.sourceIds.length > 0 && <div className="ids">{[...new Set(i.sourceIds)].map(id => <span key={id} className="chip id">{id}</span>)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
      </div>
    </section>
  );
}

function SourceReports({ ev }: { ev: Evaluation }) {
  return (
    <section className="card" aria-labelledby="src-h">
      <header>
        <div>
          <div className="title"><IconDatabase size={16} /><h2 id="src-h">Source reports</h2></div>
          <p className="section-intro">Every import available at the as-of time. The highlighted row is the one the corrected pipeline uses.</p>
        </div>
      </header>
      <div className="body" style={{ paddingTop: 4, paddingBottom: 6 }}>
        {(['current', 'previous'] as const).map(week => {
          const rows = ev.sources.filter(s => s.week === week);
          const pub = ev.publisherCurrent.find(p => p.week === week);
          const w = ev.weeks.find(x => x.week === week)!;
          return (
            <details key={week} open={week === 'current'}>
              <summary>
                <IconChevron size={14} className="chev" />
                <span>{week === 'current' ? 'Reporting week' : 'Comparison week'} · {range(w.periodStart, w.expectedPeriodEnd)}</span>
                <span className="subtle" style={{ fontWeight: 400 }}>{rows.length} import{rows.length === 1 ? '' : 's'} · publisher current {pub ? <span className="mono">{pub.publisherReportId}</span> : 'none'}</span>
              </summary>
              {rows.length === 0 ? <p className="subtle" style={{ padding: '0 0 12px 22px' }}>No imported reports for this week.</p> : (
                <div className="table-wrap" style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <table className="compact">
                    <thead>
                      <tr><th>Import</th><th>Publisher report</th><th>Status</th><th>Covers to</th><th>Generated</th><th style={{ textAlign: 'right' }}>Loaded</th><th style={{ textAlign: 'right' }}>Header</th><th style={{ textAlign: 'right' }}>Publisher</th></tr>
                    </thead>
                    <tbody>
                      {rows.map(s => {
                        const superseded = s.exported?.supersededBy;
                        const loadedOk = s.exported ? s.activeSubscriptions === s.exported.offerSum && s.loadedOffers === s.exported.offerCount : false;
                        return (
                          <tr key={s.reportId} className={s.selected ? 'selected' : ''}>
                            <td className="mono">{s.reportId}{s.selected && <> <span className="chip accent">used</span></>}</td>
                            <td className="mono">{s.publisherReportId}
                              {superseded ? <span className="subtle" style={{ display: 'block', fontFamily: 'var(--sans)' }}>superseded by <span className="mono">{superseded}</span></span>
                                : s.exported ? null : <> <span className="chip danger">not in export</span></>}</td>
                            <td><span className={`chip ${s.status === 'complete' ? 'ok' : ''}`}>{s.status}</span></td>
                            <td className="num">{day(s.periodEnd)}</td>
                            <td className="num" style={{ whiteSpace: 'nowrap' }}>{stamp(s.generatedAt)}</td>
                            <td className="num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{int(s.activeSubscriptions)}<span className="subtle" style={{ display: 'block' }}>{s.loadedOffers} offers</span></td>
                            <td className="num" style={{ textAlign: 'right' }}>{int(s.declaredSubscriptions)}</td>
                            <td className="num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{s.exported ? <>{int(s.exported.offerSum)}<span style={{ display: 'block', marginTop: 2 }}>{loadedOk ? <span className="chip ok">match</span> : <span className="chip danger">differs</span>}</span></> : '—'}</td>
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
        <div>
          <div className="title"><IconSparkle size={16} /><h2 id="model-h">AI commentary check</h2></div>
          <p className="section-intro">The model draft is a suggestion. Operational notes are context only and cannot change the promotion policy.</p>
        </div>
        <span className={`chip ${ev.model.accepted ? 'ok' : 'danger'}`}>{ev.model.accepted ? 'Consistent with policy' : 'Rejected by policy'}</span>
      </header>
      <div className="body">
        <blockquote className="quote">“{p.narrative}”</blockquote>
        <dl className="kv" style={{ marginTop: 12 }}>
          <dt>Proposed</dt><dd>{p.action === 'expand_promotion' ? `Expand promotion by ${p.budgetChangePct}%` : 'Hold'}</dd>
          <dt>Notes retrieved</dt><dd>{ev.model.documents.length ? ev.model.documents.map(d => <span key={d.id} className="chip id" style={{ marginRight: 4 }}>{d.id}</span>) : 'none'}</dd>
          {ev.model.problems.length > 0 && <><dt>Why rejected</dt><dd><ul className="limitations plain">{ev.model.problems.map(x => <li key={x}>{x}</li>)}</ul></dd></>}
        </dl>
      </div>
    </section>
  );
}

function Context({ ev }: { ev: Evaluation }) {
  const c = ev.context;
  return (
    <section className="card" aria-labelledby="ctx-h">
      <header>
        <div className="title"><IconInfo size={16} /><h2 id="ctx-h">Supporting context</h2></div>
        <span className="subtle">Reporting week · not used by the promotion policy</span>
      </header>
      <div className="body stats">
        <div className="stat"><div className="k">Net sales</div><div className="v">{money(c.netSales)}</div></div>
        <div className="stat"><div className="k">Ad spend</div><div className="v">{money(c.adSpend)}</div></div>
        <div className="stat"><div className="k">Attributed ROAS</div><div className="v">{c.roas === null ? 'Undefined' : c.roas.toFixed(2)}</div></div>
        <div className="stat"><div className="k">Inventory units</div><div className="v">{int(c.inventoryUnits)}</div></div>
      </div>
    </section>
  );
}
