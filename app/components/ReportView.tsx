import type { CaseView } from './api.ts';
import type { ClientReport } from '../../src/review/report.ts';
import { api } from './api.ts';
import { stamp } from './format.ts';
import { IconAlert, IconDownload, IconFile, IconPrinter } from './icons.tsx';

export function ReportView({ view, onGoToDecision }: { view: CaseView; onGoToDecision: () => void }) {
  const report = view.latestReport;
  if (!report) {
    return (
      <div className="card"><div className="empty" style={{ padding: '48px 24px' }}>
        <div className="art"><IconFile size={24} /></div>
        <h2 style={{ fontSize: 16, color: 'var(--text)' }}>No client report yet</h2>
        <p style={{ marginTop: 6 }}>{view.latestDecision ? 'Use “Generate client report” in the decision panel.' : 'Save a review decision first, then generate the report from it.'}</p>
        <button className="btn small" style={{ marginTop: 16 }} onClick={onGoToDecision}>Back to evidence</button>
      </div></div>
    );
  }
  const c = report.content as ClientReport;
  return (
    <div className="report">
      {!view.reportCurrent && (
        <div className="banner danger" role="alert">
          <IconAlert size={18} />
          <div className="grow"><strong>Outdated report: do not send</strong>
            <p>It was generated from decision v{c.decisionVersion} on evidence <span className="mono">{c.evidenceFingerprint}</span>, which no longer matches the current case. Save a new decision and regenerate.</p></div>
        </div>
      )}
      <div className="report-toolbar no-print">
        <span className="subtle">Generated {stamp(report.createdAt)} · decision v{c.decisionVersion}</span>
        <span className="spacer" />
        <a className="btn small" href={api.reportUrl(view.case.caseId)} download><IconDownload size={14} /> Markdown</a>
        <button className="btn small" onClick={() => window.print()}><IconPrinter size={14} /> Print / PDF</button>
      </div>
      <article className="card doc">
        <div className="eyebrow">Weekly client report</div>
        <h1 style={{ marginTop: 6 }}>{c.title}</h1>
        <p className="subtle" style={{ marginTop: 6 }}>{c.scopeLine}</p>
        <div className="rec"><span className={`chip ${c.decision.outcome === 'approve_expansion' ? 'ok' : 'warn'}`} style={{ fontSize: 12.5, padding: '3px 10px' }}>Recommendation: {c.decision.label}</span></div>
        <p className="headline">{c.headline}</p>
        <div className="table-wrap">
          <table className="compact">
            <thead><tr><th>Measure</th><th style={{ textAlign: 'right' }}>Value</th><th>Basis</th></tr></thead>
            <tbody>{c.figures.map(f => (
              <tr key={f.label}><td>{f.label}</td><td className="num" style={{ fontWeight: 650, textAlign: 'right', whiteSpace: 'nowrap' }}>{f.value}</td><td className="muted">{f.note}</td></tr>
            ))}</tbody>
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
