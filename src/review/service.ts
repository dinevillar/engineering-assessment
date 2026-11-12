import type { PGlite } from '@electric-sql/pglite';
import { listScopes } from '../metrics.ts';
import { ALLOWED_EXPANSION_PCT } from '../policy.ts';
import { evaluateCase, type CaseEvaluation } from './evaluate.ts';
import { buildClientReport, OUTCOME_LABELS } from './report.ts';
import { OUTCOMES, ReviewStore, VersionConflict, type CaseRow, type DecisionOutcome, type DecisionRow, type EventRow, type ReportRow } from './store.ts';

export type CaseStatus = 'open' | 'decided' | 'reported' | 'needs_attention';

export interface OutcomeOption { outcome: DecisionOutcome; label: string; allowed: boolean; reason: string }

export interface CaseView {
  case: CaseRow; status: CaseStatus; evaluation: CaseEvaluation;
  latestDecision: DecisionRow | null; decisions: DecisionRow[];
  /** Why the latest decision no longer matches current evidence, if it does not. */
  attention: string | null;
  latestReport: ReportRow | null; reportCurrent: boolean;
  options: OutcomeOption[]; events: EventRow[];
}

export interface DecisionInput {
  outcome: string; reason: string; reviewer?: string;
  evidenceFingerprint: string; expectedVersion: number;
  acknowledgeLimitations: boolean; budgetChangePct?: number;
}

export class ReviewError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly details: string[] = []) { super(message); }
}

export const MIN_REASON_LENGTH = 15;

export class ReviewService {
  constructor(private readonly db: PGlite, readonly store: ReviewStore, private readonly options: { exportsDir?: string } = {}) {}

  async scopes() {
    const [scopes, cases] = await Promise.all([listScopes(this.db), this.store.listCases()]);
    return scopes.map(s => {
      const c = cases.find(x => x.brandId === s.brandId && x.marketplace === s.marketplace);
      return { ...s, caseId: c?.caseId ?? null,
        latestOutcome: c?.latest?.outcome ?? null, latestVersion: c?.latest?.version ?? 0,
        decidedAt: c?.latest?.createdAt ?? null, reports: c?.reports ?? 0 };
    });
  }

  private evaluate(brandId: string, marketplace: string) {
    return evaluateCase(this.db, brandId, marketplace, { exportsDir: this.options.exportsDir });
  }

  async openCase(brandId: string, marketplace: string): Promise<CaseView> {
    const scopes = await listScopes(this.db);
    if (!scopes.some(s => s.brandId === brandId && s.marketplace === marketplace)) {
      throw new ReviewError('UNKNOWN_SCOPE', 404, `No subscription data for brand "${brandId}" in marketplace "${marketplace}".`);
    }
    const evaluation = await this.evaluate(brandId, marketplace);
    const { row } = await this.store.findOrCreateCase(brandId, marketplace, evaluation.scope.periodStart, evaluation.scope.periodEnd);
    return this.view(row, evaluation);
  }

  async getCase(caseId: string): Promise<CaseView> {
    const row = await this.requireCase(caseId);
    return this.view(row, await this.evaluate(row.brandId, row.marketplace));
  }

  private async requireCase(caseId: string): Promise<CaseRow> {
    const row = await this.store.getCase(caseId);
    if (!row) throw new ReviewError('CASE_NOT_FOUND', 404, `Review case "${caseId}" does not exist.`);
    return row;
  }

  private async view(row: CaseRow, evaluation: CaseEvaluation): Promise<CaseView> {
    const [decisions, latestReport, events] = await Promise.all([
      this.store.decisions(row.caseId), this.store.latestReport(row.caseId), this.store.events(row.caseId)]);
    const latest = decisions[0] ?? null;
    const stale = latest !== null && latest.evidenceFingerprint !== evaluation.fingerprint;
    const reportCurrent = latestReport !== null && latest !== null && !stale
      && latestReport.decisionId === latest.decisionId && latestReport.evidenceFingerprint === evaluation.fingerprint;
    const status: CaseStatus = !latest ? 'open' : stale ? 'needs_attention' : reportCurrent ? 'reported' : 'decided';
    return {
      case: row, status, evaluation, latestDecision: latest, decisions,
      attention: stale ? describeChange(latest!, evaluation) : null,
      latestReport, reportCurrent, options: outcomeOptions(evaluation), events,
    };
  }

  /** Validates and persists a decision. All rules are enforced here, not in the UI. */
  async saveDecision(caseId: string, input: DecisionInput): Promise<CaseView> {
    const row = await this.requireCase(caseId);
    const evaluation = await this.evaluate(row.brandId, row.marketplace);
    try {
      const outcome = validateDecision(input, evaluation);
      const reason = input.reason.trim();
      await this.store.appendDecision(caseId, input.expectedVersion, {
        outcome, reason, reviewer: input.reviewer?.trim() || 'Operations reviewer',
        budgetChangePct: outcome === 'approve_expansion' ? ALLOWED_EXPANSION_PCT : 0,
        evidenceFingerprint: evaluation.fingerprint, evidence: decisionSnapshot(evaluation),
      });
    } catch (error) {
      if (error instanceof VersionConflict) {
        const e = new ReviewError('VERSION_CONFLICT', 409, `${error.message} Reload the case to see the latest decision before saving.`);
        await this.store.addEvent(caseId, 'decision_rejected', { code: e.code, outcome: input?.outcome });
        throw e;
      }
      if (error instanceof ReviewError) {
        await this.store.addEvent(caseId, 'decision_rejected', { code: error.code, outcome: input?.outcome, details: error.details });
      }
      throw error;
    }
    return this.view(row, evaluation);
  }

  /** Generates the client report from the latest decision, only if evidence is unchanged. */
  async generateReport(caseId: string): Promise<CaseView> {
    const row = await this.requireCase(caseId);
    const evaluation = await this.evaluate(row.brandId, row.marketplace);
    const latest = await this.store.latestDecision(caseId);
    if (!latest) throw new ReviewError('NO_DECISION', 409, 'Save a review decision before generating the client report.');
    if (latest.evidenceFingerprint !== evaluation.fingerprint) {
      await this.store.addEvent(caseId, 'report_blocked', { code: 'EVIDENCE_CHANGED', decisionVersion: latest.version });
      throw new ReviewError('EVIDENCE_CHANGED', 409, `The evidence changed after decision v${latest.version} was saved. Review the updated evidence and save a new decision before generating the report.`,
        [describeChange(latest, evaluation)]);
    }
    const { content, markdown } = buildClientReport(evaluation, latest);
    await this.store.saveReport({ caseId, decisionId: latest.decisionId, evidenceFingerprint: evaluation.fingerprint, content, markdown });
    return this.view(row, evaluation);
  }
}

/** Issues that need our data team to fix something (as opposed to waiting for the publisher,
 * e.g. an incomplete week, or a draft error already corrected by this review). */
export const DATA_FIX_CODES = new Set([
  'incomplete_import', 'superseded_report_selected', 'pipeline_report_missing', 'mart_mismatch',
  'publisher_report_missing', 'publisher_export_inconsistent', 'stale_import', 'import_control_total_mismatch',
]);

export function outcomeOptions(ev: CaseEvaluation): OutcomeOption[] {
  const hasDataProblems = ev.issues.some(i => DATA_FIX_CODES.has(i.code));
  const dataBlocks = ev.issues.some(i => DATA_FIX_CODES.has(i.code) && i.severity === 'blocking');
  const blockedBecause = ev.policy.rationale.replace(/^Hold:\s*/, '').split(/(?<=\.)\s/)[0];
  return [
    { outcome: 'approve_expansion', label: OUTCOME_LABELS.approve_expansion, allowed: ev.policy.expansionSupported,
      reason: ev.policy.expansionSupported ? ev.policy.rationale : `Not available: ${blockedBecause.charAt(0).toLowerCase()}${blockedBecause.slice(1)}` },
    { outcome: 'hold', label: OUTCOME_LABELS.hold, allowed: true,
      reason: ev.policy.action === 'hold' ? 'Supported by the evidence.' : 'Allowed: a reviewer may always hold.' },
    { outcome: 'hold_pending_data', label: OUTCOME_LABELS.hold_pending_data, allowed: true,
      reason: hasDataProblems && dataBlocks ? 'Recommended: an internal data issue blocks verification and must be fixed upstream.'
        : hasDataProblems ? 'Optional: an import needs fixing upstream, but the publisher figure already corrects it.'
        : 'No internal data issue detected; use only if you found one.' },
  ];
}

export function validateDecision(input: DecisionInput, ev: CaseEvaluation): DecisionOutcome {
  if (!input || typeof input !== 'object') throw new ReviewError('INVALID_REQUEST', 400, 'Decision payload is missing.');
  if (!OUTCOMES.includes(input.outcome as DecisionOutcome)) {
    throw new ReviewError('INVALID_OUTCOME', 400, `Unknown outcome "${input.outcome}". Choose one of: ${OUTCOMES.join(', ')}.`);
  }
  const outcome = input.outcome as DecisionOutcome;
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new ReviewError('INVALID_REQUEST', 400, 'expectedVersion must be a non-negative integer.');
  if (typeof input.evidenceFingerprint !== 'string' || input.evidenceFingerprint !== ev.fingerprint) {
    throw new ReviewError('EVIDENCE_CHANGED', 409, 'The evidence changed since you loaded this case. Review the updated evidence, then save again.');
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new ReviewError('REASON_REQUIRED', 422, `Explain the decision in at least ${MIN_REASON_LENGTH} characters.`);
  }
  if (ev.limitations.length > 0 && input.acknowledgeLimitations !== true) {
    throw new ReviewError('LIMITATIONS_NOT_ACKNOWLEDGED', 422, 'Confirm that the listed limitations will be saved with the decision.');
  }
  if (outcome === 'approve_expansion') {
    if (!ev.policy.expansionSupported) {
      throw new ReviewError('UNSUPPORTED_APPROVAL', 422, 'A promotion expansion cannot be approved: the evidence does not support a comparable growth claim.',
        [ev.policy.rationale, ...ev.quality.reasons]);
    }
    if (input.budgetChangePct !== undefined && input.budgetChangePct !== ALLOWED_EXPANSION_PCT) {
      throw new ReviewError('UNSUPPORTED_APPROVAL', 422, `Policy allows exactly a ${ALLOWED_EXPANSION_PCT}% expansion; ${input.budgetChangePct}% was requested.`);
    }
  }
  return outcome;
}

export function decisionSnapshot(ev: CaseEvaluation) {
  const [cur, prev] = ev.weeks;
  const calc = cur.publisher !== null && prev.publisher !== null && prev.publisher > 0
    ? `${cur.publisher.toLocaleString('en-US')} / ${prev.publisher.toLocaleString('en-US')} − 1 = ${ev.growth.observedPct}%${ev.growth.comparable ? ' (comparable)' : ' (not comparable)'}`
    : 'Change not computable: a publisher figure is missing or the baseline is zero.';
  return {
    scope: ev.scope, weeks: ev.weeks, growth: ev.growth, calculation: calc,
    policy: ev.policy,
    sourceIds: [...new Set(ev.weeks.flatMap(w => [...w.pipelineReportIds, ...(w.publisherReportId ? [w.publisherReportId] : [])]))],
    issues: ev.issues.map(i => ({ code: i.code, severity: i.severity, week: i.week, message: i.message, sourceIds: i.sourceIds })),
    limitations: ev.limitations,
    modelProposal: { ...ev.model.proposal, accepted: ev.model.accepted, problems: ev.model.problems },
  };
}

/** Human-readable summary of what differs between a saved decision and current evidence. */
export function describeChange(decision: DecisionRow, ev: CaseEvaluation): string {
  const saved = decision.evidence as ReturnType<typeof decisionSnapshot> | null;
  const changes: string[] = [];
  if (saved?.weeks) {
    for (const [i, w] of ev.weeks.entries()) {
      const old = saved.weeks[i];
      if (!old) continue;
      const label = w.week === 'current' ? 'Reporting week' : 'Comparison week';
      if (old.publisher !== w.publisher || old.publisherReportId !== w.publisherReportId || old.publisherStatus !== w.publisherStatus) {
        changes.push(`${label}: ${old.publisher?.toLocaleString('en-US') ?? 'unavailable'} (${old.publisherReportId ?? 'none'}, ${old.publisherStatus ?? '—'}) → ${w.publisher?.toLocaleString('en-US') ?? 'unavailable'} (${w.publisherReportId ?? 'none'}, ${w.publisherStatus ?? '—'})`);
      }
      if (old.pipeline !== w.pipeline) changes.push(`${label} pipeline figure: ${old.pipeline ?? 'unavailable'} → ${w.pipeline ?? 'unavailable'}`);
    }
    if (saved.policy?.action !== ev.policy.action) changes.push(`Supported action: ${saved.policy?.action} → ${ev.policy.action}`);
  }
  return `Evidence changed since decision v${decision.version}${changes.length ? `: ${changes.join('; ')}` : ' (source report metadata differs)'}.`;
}
