'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, type CaseView, type Scope } from './api.ts';
import { OUTCOME_SHORT, STATUS_LABEL, range, stamp } from './format.ts';
import { EvidencePanel } from './EvidencePanel.tsx';
import { DecisionPanel } from './DecisionPanel.tsx';
import { ReportView } from './ReportView.tsx';
import { HistoryPanel } from './HistoryPanel.tsx';
import { KpiStrip, Stepper } from './CaseSummary.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';
import { IconAlert, IconCheckCircle, IconChevron, IconClock, IconFile, IconRefresh, IconSearch, IconShield } from './icons.tsx';

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
    void load('Reopening saved case', signal => api.getCase(caseParam, signal));
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
    void load('Re-validating evidence', signal => api.getCase(id, signal));
  };

  const view = state.kind === 'ready' ? state.view : state.kind === 'loading' ? state.previous : null;
  const activeKey = view ? `${view.case.brandId}|${view.case.marketplace}` : null;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brandmark"><IconShield size={16} /></span>
          <span className="name">Report Review</span>
          <span className="sep" aria-hidden="true" />
          <span className="pill hide-sm"><strong>Week of Sep 28 – Oct 4, 2026</strong> vs. prior week</span>
        </div>
        <div className="right">
          <span className="pill hide-sm" title="Fixed evaluation clock for this reporting cycle"><IconClock size={13} /> Data as of Oct 6, 12:00 UTC</span>
          <ThemeToggle />
        </div>
      </header>
      <div className="shell">
        <nav className="sidebar" aria-label="Review cases">
          <div className="sidebar-head">
            <span className="eyebrow">Review cases</span>
            {scopes && <span className="chip">{scopes.length}</span>}
          </div>
          <ScopeList scopes={scopes} error={scopeError} onRetry={loadScopes} activeKey={activeKey}
            activeStatus={view?.status ?? null} loading={state.kind === 'loading'} onSelect={openScope} />
          <div className="sidebar-foot" aria-label="Legend">
            <span className="legend"><span className="dot" /> Not reviewed</span>
            <span className="legend"><span className="dot accent" /> Decision saved</span>
            <span className="legend"><span className="dot ok" /> Client report ready</span>
            <span className="legend"><span className="dot danger" /> Evidence changed</span>
          </div>
        </nav>
        <main className="main" aria-busy={state.kind === 'loading'}>
          {state.kind === 'empty' && <EmptyState />}
          {state.kind === 'error' && (
            <div className="banner danger" role="alert">
              <IconAlert size={18} />
              <div className="grow">
                <strong>Could not load {state.label}</strong>
                <p>{state.error.message}</p>
                {state.error.details.map(d => <p key={d} className="subtle">{d}</p>)}
              </div>
              <button className="btn small" onClick={state.retry}><IconRefresh size={14} /> Retry</button>
            </div>
          )}
          {state.kind === 'loading' && !view && <LoadingCase label={state.label} />}
          {view && (
            <div style={{ opacity: state.kind === 'loading' ? 0.5 : 1, transition: 'opacity .15s', pointerEvents: state.kind === 'loading' ? 'none' : undefined }}
              aria-hidden={state.kind === 'loading'}>
              {state.kind === 'loading' && (
                <div className="banner info" role="status"><span className="spinner" style={{ color: 'var(--accent)', marginTop: 3 }} />
                  <div className="grow"><strong>{state.label}…</strong><p className="subtle">Rebuilding the weekly mart and reconciling against publisher exports.</p></div></div>
              )}
              <CaseHeader view={view} onRecheck={recheck} busy={state.kind === 'loading'} />
              {view.status === 'needs_attention' && (
                <div className="banner danger" role="alert">
                  <IconAlert size={18} />
                  <div className="grow">
                    <strong>Evidence changed after decision v{view.latestDecision?.version} was saved</strong>
                    <p>{view.attention}</p>
                    <p className="subtle" style={{ marginTop: 4 }}>The saved decision is kept for audit but can no longer produce a client report. Review the updated evidence and save a new decision.</p>
                  </div>
                </div>
              )}
              <Stepper view={view} />
              <KpiStrip view={view} />
              <div className="case-grid">
                <div style={{ minWidth: 0 }}>
                  <div className="tabs" role="tablist" aria-label="Case sections">
                    <TabButton id="evidence" tab={tab} setTab={setTab}>Evidence
                      <span className="chip">{view.evaluation.issues.length}</span></TabButton>
                    <TabButton id="report" tab={tab} setTab={setTab}>Client report
                      {view.latestReport && <span className={`chip ${view.reportCurrent ? 'ok' : 'danger'}`}>{view.reportCurrent ? 'Current' : 'Outdated'}</span>}
                    </TabButton>
                    <TabButton id="history" tab={tab} setTab={setTab}>History
                      <span className="chip">{view.decisions.length}</span></TabButton>
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
      {toast && <div className="toast" role="status"><IconCheckCircle size={18} />{toast}</div>}
    </>
  );
}

function TabButton({ id, tab, setTab, children }: { id: Tab; tab: Tab; setTab: (t: Tab) => void; children: React.ReactNode }) {
  return <button role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{children}</button>;
}

function scopeState(s: Scope, isActive: boolean, activeStatus: CaseView['status'] | null): { tone: string; text: string } {
  if (isActive && activeStatus === 'needs_attention') return { tone: 'danger', text: 'Evidence changed' };
  if (!s.latestOutcome) return { tone: '', text: 'Not reviewed' };
  const outcome = OUTCOME_SHORT[s.latestOutcome] ?? s.latestOutcome;
  if (isActive && activeStatus === 'reported') return { tone: 'ok', text: `${outcome} · reported` };
  if (isActive && activeStatus === 'decided') return { tone: 'accent', text: `${outcome} · v${s.latestVersion}` };
  return s.reports ? { tone: 'ok', text: `${outcome} · reported` } : { tone: 'accent', text: `${outcome} · v${s.latestVersion}` };
}

function ScopeList({ scopes, error, onRetry, activeKey, activeStatus, loading, onSelect }: {
  scopes: Scope[] | null; error: ApiError | null; onRetry: () => void; activeKey: string | null;
  activeStatus: CaseView['status'] | null; loading: boolean; onSelect: (s: Scope) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { brandName: string; items: Scope[] }>();
    for (const s of scopes ?? []) {
      const g = map.get(s.brandId) ?? { brandName: s.brandName, items: [] };
      g.items.push(s); map.set(s.brandId, g);
    }
    return [...map.values()];
  }, [scopes]);

  if (error) return (
    <div className="banner danger" role="alert">
      <IconAlert size={16} />
      <div className="grow"><strong>Cases unavailable</strong><p className="subtle">{error.message}</p>
        <button className="btn small" style={{ marginTop: 8 }} onClick={onRetry}><IconRefresh size={14} /> Retry</button></div>
    </div>
  );
  if (!scopes) return <div style={{ display: 'grid', gap: 8, padding: '0 8px' }} aria-label="Loading cases">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 36 }} />)}</div>;
  if (scopes.length === 0) return <p className="subtle" style={{ padding: '0 8px' }}>No brand or marketplace has subscription reports in the source data.</p>;
  return (
    <div className="scope-groups">
      {groups.map(g => (
        <div key={g.brandName} className="scope-group">
          <div className="group-name">{g.brandName}</div>
          <ul className="scope-list">
            {g.items.map(s => {
              const key = `${s.brandId}|${s.marketplace}`;
              const active = activeKey === key;
              const st = scopeState(s, active, activeStatus);
              return (
                <li key={key}>
                  <button className="scope-btn" aria-current={active} disabled={loading && active} onClick={() => onSelect(s)}
                    aria-label={`${s.brandName} ${s.marketplace}: ${st.text}`}>
                    <span className={`dot ${st.tone}`} />
                    <span style={{ minWidth: 0 }}>
                      <span className="mp" style={{ display: 'block' }}>{s.marketplace} marketplace</span>
                      <span className="state" style={{ display: 'block' }}>{st.text}</span>
                    </span>
                    <IconChevron size={14} className="go" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CaseHeader({ view, onRecheck, busy }: { view: CaseView; onRecheck: () => void; busy: boolean }) {
  const s = view.evaluation.scope;
  const status = STATUS_LABEL[view.status];
  return (
    <div className="case-header">
      <div style={{ minWidth: 0 }}>
        <div className="crumbs"><span>Review cases</span><IconChevron size={12} /><span>{s.brandName}</span><IconChevron size={12} /><span>{s.marketplace}</span></div>
        <h1>{s.brandName} <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>· {s.marketplace}</span></h1>
        <div className="meta">
          <span>Week {range(s.periodStart, s.periodEnd)}</span>
          <span title="Case identifier"><IconFile size={13} /> <span className="mono">{view.case.caseId}</span></span>
          <span title="Evidence fingerprint: changes whenever any source figure, report or finding changes"><IconShield size={13} /> <span className="mono">{view.evaluation.fingerprint}</span></span>
          {view.latestDecision && <span><IconClock size={13} /> Decided {stamp(view.latestDecision.createdAt)}</span>}
        </div>
      </div>
      <div className="actions-row">
        <span className="status"><span className={`dot ${status.tone}`} />{status.label}</span>
        <button className="btn small" onClick={onRecheck} disabled={busy} title="Re-read the source data and exports and re-validate the saved decision">
          <IconRefresh size={14} /> Re-check evidence
        </button>
      </div>
    </div>
  );
}

function LoadingCase({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <div className="banner info"><span className="spinner" style={{ color: 'var(--accent)', marginTop: 3 }} />
        <div className="grow"><strong>{label}…</strong><p className="subtle">Rebuilding the weekly mart and reconciling against publisher exports. The first case after a restart takes a few seconds.</p></div></div>
      <div className="skeleton" style={{ height: 30, width: 340, marginBottom: 18 }} />
      <div className="skeleton" style={{ height: 52, marginBottom: 18 }} />
      <div className="kpis">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 96 }} />)}</div>
      <div className="case-grid">
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="skeleton" style={{ height: 240 }} />
          <div className="skeleton" style={{ height: 160 }} />
        </div>
        <div className="skeleton" style={{ height: 360 }} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty">
      <div className="art"><IconSearch size={26} /></div>
      <h1>Select a case to review</h1>
      <p>Each case checks this week&apos;s subscription figures against the publisher&apos;s own reports before anything is sent to the client.</p>
      <ol className="steps">
        <li><span><strong>Open a case</strong> from the list. Saved cases reopen with their decision.</span></li>
        <li><span><strong>Compare</strong> the draft figures with the publisher export and read the findings.</span></li>
        <li><span><strong>Decide</strong> with a reason. Unsupported approvals are rejected by the server.</span></li>
        <li><span><strong>Generate</strong> the client report from the saved decision.</span></li>
      </ol>
    </div>
  );
}
