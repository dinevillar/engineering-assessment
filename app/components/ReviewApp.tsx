'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, type CaseView, type Scope } from './api.ts';
import { OUTCOME_SHORT, STATUS_LABEL, range, stamp } from './format.ts';
import { EvidencePanel } from './EvidencePanel.tsx';
import { DecisionPanel } from './DecisionPanel.tsx';
import { ReportView } from './ReportView.tsx';
import { HistoryPanel } from './HistoryPanel.tsx';

type CaseState =
  | { kind: 'empty' }
  | { kind: 'loading'; label: string; previous: CaseView | null }
  | { kind: 'ready'; view: CaseView }
  | { kind: 'error'; label: string; error: ApiError; retry: () => void };

type Tab = 'evidence' | 'report' | 'history';

export function ReviewApp() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const caseParam = params.get('case');

  const [scopes, setScopes] = useState<Scope[] | null>(null);
  const [scopeError, setScopeError] = useState<ApiError | null>(null);
  const [state, setState] = useState<CaseState>({ kind: 'empty' });
  const [tab, setTab] = useState<Tab>('evidence');
  const [toast, setToast] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const loadedCase = state.kind === 'ready' ? state.view.case.caseId : null;

  const loadScopes = useCallback(async () => {
    setScopeError(null);
    try { setScopes(await api.scopes()); }
    catch (e) { setScopeError(e instanceof ApiError ? e : new ApiError('UNKNOWN', String(e), 0)); }
  }, []);
  useEffect(() => { void loadScopes(); }, [loadScopes]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  /** Loads a case; aborts any in-flight load so a fast re-selection never shows stale data. */
  const load = useCallback(async (label: string, fetcher: (signal: AbortSignal) => Promise<CaseView>) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState(prev => ({ kind: 'loading', label, previous: prev.kind === 'ready' ? prev.view : null }));
    try {
      const view = await fetcher(controller.signal);
      if (controller.signal.aborted) return;
      setState({ kind: 'ready', view });
      if (params.get('case') !== view.case.caseId) router.replace(`${pathname}?case=${encodeURIComponent(view.case.caseId)}`, { scroll: false });
    } catch (e) {
      if (controller.signal.aborted || (e as Error).name === 'AbortError') return;
      const error = e instanceof ApiError ? e : new ApiError('UNKNOWN', String(e), 0);
      setState({ kind: 'error', label, error, retry: () => void load(label, fetcher) });
    }
  }, [params, pathname, router]);

  // Open the case named in the URL (reopen after restart / shared link).
  useEffect(() => {
    if (!caseParam || caseParam === loadedCase || state.kind === 'loading') return;
    void load('Reopening saved case…', signal => api.getCase(caseParam, signal));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseParam]);

  const openScope = (s: Scope) => {
    setTab('evidence');
    void load(`${s.brandName} · ${s.marketplace}`, signal => api.openCase(s.brandId, s.marketplace, signal));
  };

  const onUpdated = (view: CaseView, message: string, nextTab?: Tab) => {
    setState({ kind: 'ready', view });
    setToast(message);
    if (nextTab) setTab(nextTab);
    void loadScopes();
  };

  const recheck = () => {
    if (state.kind !== 'ready') return;
    const id = state.view.case.caseId;
    void load('Re-validating evidence…', signal => api.getCase(id, signal));
  };

  const activeScope = state.kind === 'ready' ? `${state.view.case.brandId}|${state.view.case.marketplace}` : null;
  const view = state.kind === 'ready' ? state.view : state.kind === 'loading' ? state.previous : null;

  return (
    <>
      <header className="topbar">
        <div className="product">
          <strong>Subscription report review</strong>
          <span className="subtle">Reporting week Sep 28 – Oct 4, 2026 vs. prior week · data as of Oct 6, 12:00 UTC</span>
        </div>
        <span className="subtle tagline">Publisher exports are authoritative</span>
      </header>
      <div className="shell">
        <nav className="sidebar" aria-label="Brand and marketplace">
          <h2>Cases</h2>
          <ScopeList scopes={scopes} error={scopeError} onRetry={loadScopes} active={activeScope}
            loading={state.kind === 'loading'} onSelect={openScope} />
        </nav>
        <main className="main" aria-busy={state.kind === 'loading'}>
          {state.kind === 'empty' && <EmptyState />}
          {state.kind === 'error' && (
            <div className="banner danger" role="alert">
              <div>
                <strong>Could not load {state.label}</strong>
                <p>{state.error.message}</p>
                {state.error.details.map(d => <p key={d} className="subtle">{d}</p>)}
              </div>
              <button className="btn small" onClick={state.retry}>Retry</button>
            </div>
          )}
          {state.kind === 'loading' && !view && <LoadingCase label={state.label} />}
          {view && (
            <div style={{ opacity: state.kind === 'loading' ? 0.45 : 1, transition: 'opacity .15s' }} aria-hidden={state.kind === 'loading'}>
              {state.kind === 'loading' && (
                <div className="banner info" role="status"><span><span className="spinner" /> &nbsp;Loading {state.label}</span></div>
              )}
              <CaseHeader view={view} onRecheck={recheck} busy={state.kind === 'loading'} />
              {view.status === 'needs_attention' && (
                <div className="banner danger" role="alert">
                  <div>
                    <strong>The evidence changed after decision v{view.latestDecision?.version} was saved</strong>
                    <p>{view.attention}</p>
                    <p className="subtle">The saved decision is kept for audit but can no longer produce a client report. Review the updated evidence and save a new decision.</p>
                  </div>
                </div>
              )}
              <div className="case-grid">
                <div>
                  <div className="tabs" role="tablist" aria-label="Case sections">
                    <TabButton id="evidence" tab={tab} setTab={setTab}>Evidence</TabButton>
                    <TabButton id="report" tab={tab} setTab={setTab}>
                      Client report {view.latestReport && <span className={`chip ${view.reportCurrent ? 'ok' : 'danger'} count`}>{view.reportCurrent ? 'current' : 'outdated'}</span>}
                    </TabButton>
                    <TabButton id="history" tab={tab} setTab={setTab}>
                      History <span className="chip count">{view.decisions.length}</span>
                    </TabButton>
                  </div>
                  <div role="tabpanel">
                    {tab === 'evidence' && <EvidencePanel evaluation={view.evaluation} />}
                    {tab === 'report' && <ReportView view={view} onGoToDecision={() => setTab('evidence')} />}
                    {tab === 'history' && <HistoryPanel view={view} />}
                  </div>
                </div>
                <aside className="rail" aria-label="Decision">
                  <DecisionPanel key={`${view.case.caseId}:${view.latestDecision?.version ?? 0}:${view.evaluation.fingerprint}`}
                    view={view} disabled={state.kind === 'loading'}
                    onSaved={v => onUpdated(v, `Decision v${v.latestDecision?.version} saved`)}
                    onReported={v => onUpdated(v, 'Client report generated', 'report')}
                    onReload={recheck} />
                </aside>
              </div>
            </div>
          )}
        </main>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function TabButton({ id, tab, setTab, children }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; children: React.ReactNode }) {
  return <button role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{children}</button>;
}

function ScopeList({ scopes, error, onRetry, active, loading, onSelect }: {
  scopes: Scope[] | null; error: ApiError | null; onRetry: () => void; active: string | null; loading: boolean; onSelect: (s: Scope) => void;
}) {
  if (error) return (
    <div className="banner danger" role="alert" style={{ display: 'block' }}>
      <strong>Cases unavailable</strong><p className="subtle">{error.message}</p>
      <button className="btn small" style={{ marginTop: 8 }} onClick={onRetry}>Retry</button>
    </div>
  );
  if (!scopes) return <div style={{ display: 'grid', gap: 8, padding: '0 8px' }}>{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 40 }} />)}</div>;
  if (scopes.length === 0) return <p className="subtle" style={{ padding: '0 8px' }}>No brand/marketplace has subscription reports in the source data.</p>;
  return (
    <ul className="scope-list">
      {scopes.map(s => {
        const key = `${s.brandId}|${s.marketplace}`;
        return (
          <li key={key}>
            <button className="scope-btn" aria-current={active === key} disabled={loading && active === key} onClick={() => onSelect(s)}>
              <span className="row"><span className="name">{s.brandName}</span><span className="chip">{s.marketplace}</span></span>
              <span className="row subtle">
                {s.latestOutcome ? <span>v{s.latestVersion} · {OUTCOME_SHORT[s.latestOutcome] ?? s.latestOutcome}{s.reports ? ' · reported' : ''}</span> : <span>Not reviewed</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CaseHeader({ view, onRecheck, busy }: { view: CaseView; onRecheck: () => void; busy: boolean }) {
  const s = view.evaluation.scope;
  const status = STATUS_LABEL[view.status];
  return (
    <div className="case-header">
      <div>
        <h1>{s.brandName} · {s.marketplace}</h1>
        <div className="meta subtle">
          <span>Week {range(s.periodStart, s.periodEnd)}</span>
          <span>Case <span className="mono">{view.case.caseId}</span></span>
          <span title="Changes whenever any source figure, report or finding changes">Evidence <span className="mono">{view.evaluation.fingerprint}</span></span>
          {view.latestDecision && <span>Last decision {stamp(view.latestDecision.createdAt)}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className={`chip ${status.tone}`}>{status.label}</span>
        <button className="btn small" onClick={onRecheck} disabled={busy} title="Re-read the source data and exports and re-validate the saved decision">Re-check evidence</button>
      </div>
    </div>
  );
}

function LoadingCase({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <p className="muted" style={{ marginBottom: 12 }}><span className="spinner" /> &nbsp;{label}: rebuilding the weekly mart and reconciling against publisher exports…</p>
      <div className="skeleton" style={{ height: 28, width: 320, marginBottom: 16 }} />
      <div className="case-grid">
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="skeleton" style={{ height: 200 }} />
          <div className="skeleton" style={{ height: 140 }} />
        </div>
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <h1>Choose a brand and marketplace to review</h1>
      <p>Each case checks this week&apos;s subscription figures against the publisher&apos;s own reports before anything goes to the client.</p>
      <ol className="steps">
        <li>Open a case from the list. Cases you saved earlier reopen with their decision.</li>
        <li>Compare the draft figures with the publisher export and read the findings.</li>
        <li>Save a decision with your reason. Unsupported approvals are rejected.</li>
        <li>Generate the client report from the saved decision.</li>
      </ol>
    </div>
  );
}
