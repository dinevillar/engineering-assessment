import type { CaseView } from './api.ts';
import type { ClientReport } from '../../src/review/report.ts';
import { api } from './api.ts';
import { stamp } from './format.ts';

export function ReportView({ view, onGoToDecision }: { view: CaseView; onGoToDecision: () => void }) {
  const report = view.latestReport;
  if (!report) {
    return (
      <div className="card"><div className="empty">
        <h2>No client report yet</h2>
        <p style={{ marginTop: 6 }}>{view.latestDecision ? 'Use “Generate client report” in the decision panel.' : 'Save a review decision, then generate the report from it.'}</p>
        <button className="btn small" style={{ marginTop: 12 }} onClick={onGoToDecision}>Back to evidence</button>
      </div></div>
    );
  }
  const c = report.content as ClientReport;
  return (
    <div className="report">
      {!view.reportCurrent && (
        <div className="banner danger" role="alert">
          <div><strong>Outdated report: do not send</strong>
            <p>It was generated from decision v{c.decisionVersion} on evidence <span className="mono">{c.evidenceFingerprint}</span>, which no longer matches the current case. Save a new decision and regenerate.</p></div>
        </div>
      )}
      <div className="actions no-print" style={{ marginTop: 0, marginBottom: 12 }}>
        <a className="btn small" href={api.reportUrl(view.case.caseId)} download>Download Markdown</a>
        <button className="btn small" onClick={() => window.print()}>Print / PDF</button>
        <span className="subtle">Generated {stamp(report.createdAt)}</span>
      </div>
      <article className="card doc">
        <h1>{c.title}</h1>
        <p className="subtle" style={{ marginTop: 4 }}>{c.scopeLine}</p>
        <span className={`chip rec ${c.decision.outcome === 'approve_expansion' ? 'ok' : 'warn'}`}>Recommendation: {c.decision.label}</span>
        <p className="headline">{c.headline}</p>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>Measure</th><th>Value</th><th>Basis</th></tr></thead>
            <tbody>{c.figures.map(f => <tr key={f.label}><td>{f.label}</td><td className="num" style={{ fontWeight: 650 }}>{f.value}</td><td className="muted">{f.note}</td></tr>)}</tbody>
          </table>
        </div>
        <h2>Data notes</h2>
        <ul>{c.notes.map(n => <li key={n}>{n}</li>)}</ul>
        <h2>Next step</h2>
        <p>{c.nextStep}</p>
        <h2>Reviewer&apos;s reason</h2>
        <p>{c.reason}</p>
        <footer className="subtle">
          Reviewed by {c.reviewer} · decision v{c.decisionVersion} · sources {c.sources.join(', ') || 'none verified'} · evidence <span className="mono">{c.evidenceFingerprint}</span>
        </footer>
      </article>
    </div>
  );
}
