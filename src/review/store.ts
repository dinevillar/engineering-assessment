import { PGlite } from '@electric-sql/pglite';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROOT } from '../database.ts';

/** Review state owned by the application. Separate from the source snapshot so source data
 * stays untouched and `npm run reset` (which rebuilds the source working copy) keeps reviews. */
export const DEFAULT_STORE_DIR = path.join(ROOT, '.review-store');

export type DecisionOutcome = 'approve_expansion' | 'hold' | 'hold_pending_data';
export const OUTCOMES: DecisionOutcome[] = ['approve_expansion', 'hold', 'hold_pending_data'];

export interface CaseRow { caseId: string; brandId: string; marketplace: string; periodStart: string; periodEnd: string; createdAt: string }
export interface DecisionRow {
  decisionId: string; caseId: string; version: number; outcome: DecisionOutcome; budgetChangePct: number;
  reason: string; reviewer: string; evidenceFingerprint: string;
  /** Snapshot of the evidence the decision was made on: scope, source ids, figures, calculation, limitations. */
  evidence: unknown; createdAt: string;
}
export interface ReportRow { reportId: string; caseId: string; decisionId: string; evidenceFingerprint: string; content: unknown; markdown: string; createdAt: string }
export interface EventRow { at: string; kind: string; detail: unknown }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS review_cases (
  case_id text PRIMARY KEY, brand_id text NOT NULL, marketplace text NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand_id, marketplace, period_start));
CREATE TABLE IF NOT EXISTS review_decisions (
  decision_id text PRIMARY KEY, case_id text NOT NULL REFERENCES review_cases,
  version integer NOT NULL, outcome text NOT NULL CHECK (outcome IN ('approve_expansion','hold','hold_pending_data')),
  budget_change_pct numeric NOT NULL, reason text NOT NULL, reviewer text NOT NULL,
  evidence_fingerprint text NOT NULL, evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version));
CREATE TABLE IF NOT EXISTS review_reports (
  report_id text PRIMARY KEY, case_id text NOT NULL REFERENCES review_cases,
  decision_id text NOT NULL REFERENCES review_decisions, evidence_fingerprint text NOT NULL,
  content jsonb NOT NULL, markdown text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS review_events (
  event_id bigserial PRIMARY KEY, case_id text NOT NULL REFERENCES review_cases,
  at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, detail jsonb NOT NULL);`;

const iso = (v: unknown): string => v instanceof Date ? v.toISOString() : String(v);
const day = (v: unknown): string => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

export class ReviewStore {
  private constructor(private readonly db: PGlite) {}

  static async open(dir: string | null = DEFAULT_STORE_DIR): Promise<ReviewStore> {
    if (dir) await mkdir(dir, { recursive: true });
    const db = new PGlite(dir ? { dataDir: dir } : {});
    await db.waitReady;
    await db.exec("SET TIME ZONE 'UTC'");
    await db.exec(SCHEMA);
    return new ReviewStore(db);
  }

  close(): Promise<void> { return this.db.close(); }

  async findOrCreateCase(brandId: string, marketplace: string, periodStart: string, periodEnd: string): Promise<{ row: CaseRow; created: boolean }> {
    const existing = await this.findCase(brandId, marketplace, periodStart);
    if (existing) return { row: existing, created: false };
    const caseId = `${brandId}.${marketplace}.${periodStart}`.toLowerCase();
    await this.db.query(`INSERT INTO review_cases (case_id, brand_id, marketplace, period_start, period_end)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [caseId, brandId, marketplace, periodStart, periodEnd]);
    await this.addEvent(caseId, 'case_opened', { brandId, marketplace, periodStart });
    return { row: (await this.getCase(caseId))!, created: true };
  }

  async findCase(brandId: string, marketplace: string, periodStart: string): Promise<CaseRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM review_cases WHERE brand_id=$1 AND marketplace=$2 AND period_start=$3::date`, [brandId, marketplace, periodStart]);
    return rows[0] ? toCase(rows[0]) : null;
  }

  async getCase(caseId: string): Promise<CaseRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(`SELECT * FROM review_cases WHERE case_id=$1`, [caseId]);
    return rows[0] ? toCase(rows[0]) : null;
  }

  async listCases(): Promise<(CaseRow & { latest: DecisionRow | null; reports: number })[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(`SELECT * FROM review_cases ORDER BY brand_id, marketplace, period_start`);
    return Promise.all(rows.map(async r => {
      const c = toCase(r);
      const [count] = (await this.db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM review_reports WHERE case_id=$1`, [c.caseId])).rows;
      return { ...c, latest: await this.latestDecision(c.caseId), reports: count.n };
    }));
  }

  async latestDecision(caseId: string): Promise<DecisionRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM review_decisions WHERE case_id=$1 ORDER BY version DESC LIMIT 1`, [caseId]);
    return rows[0] ? toDecision(rows[0]) : null;
  }

  async decisions(caseId: string): Promise<DecisionRow[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM review_decisions WHERE case_id=$1 ORDER BY version DESC`, [caseId]);
    return rows.map(toDecision);
  }

  /** Appends a decision version. Fails with VersionConflict if another save happened first. */
  async appendDecision(caseId: string, expectedVersion: number, d: Omit<DecisionRow, 'decisionId' | 'caseId' | 'version' | 'createdAt'>): Promise<DecisionRow> {
    return this.db.transaction(async tx => {
      const [{ v }] = (await tx.query<{ v: number }>(`SELECT COALESCE(MAX(version),0)::int AS v FROM review_decisions WHERE case_id=$1`, [caseId])).rows;
      if (v !== expectedVersion) throw new VersionConflict(v);
      const decisionId = randomUUID();
      await tx.query(`INSERT INTO review_decisions (decision_id, case_id, version, outcome, budget_change_pct, reason, reviewer, evidence_fingerprint, evidence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [decisionId, caseId, v + 1, d.outcome, d.budgetChangePct, d.reason, d.reviewer, d.evidenceFingerprint, JSON.stringify(d.evidence)]);
      await tx.query(`INSERT INTO review_events (case_id, kind, detail) VALUES ($1,'decision_saved',$2)`,
        [caseId, JSON.stringify({ version: v + 1, outcome: d.outcome, fingerprint: d.evidenceFingerprint })]);
      const { rows } = await tx.query<Record<string, unknown>>(`SELECT * FROM review_decisions WHERE decision_id=$1`, [decisionId]);
      return toDecision(rows[0]);
    });
  }

  async saveReport(r: Omit<ReportRow, 'reportId' | 'createdAt'>): Promise<ReportRow> {
    const reportId = randomUUID();
    await this.db.query(`INSERT INTO review_reports (report_id, case_id, decision_id, evidence_fingerprint, content, markdown) VALUES ($1,$2,$3,$4,$5,$6)`,
      [reportId, r.caseId, r.decisionId, r.evidenceFingerprint, JSON.stringify(r.content), r.markdown]);
    await this.addEvent(r.caseId, 'report_generated', { reportId, decisionId: r.decisionId });
    return (await this.latestReport(r.caseId))!;
  }

  async latestReport(caseId: string): Promise<ReportRow | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM review_reports WHERE case_id=$1 ORDER BY created_at DESC, report_id LIMIT 1`, [caseId]);
    const r = rows[0];
    return r ? { reportId: String(r.report_id), caseId: String(r.case_id), decisionId: String(r.decision_id),
      evidenceFingerprint: String(r.evidence_fingerprint), content: r.content, markdown: String(r.markdown), createdAt: iso(r.created_at) } : null;
  }

  async addEvent(caseId: string, kind: string, detail: unknown): Promise<void> {
    await this.db.query(`INSERT INTO review_events (case_id, kind, detail) VALUES ($1,$2,$3)`, [caseId, kind, JSON.stringify(detail)]);
  }

  async events(caseId: string, limit = 20): Promise<EventRow[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT at, kind, detail FROM review_events WHERE case_id=$1 ORDER BY event_id DESC LIMIT $2`, [caseId, limit]);
    return rows.map(r => ({ at: iso(r.at), kind: String(r.kind), detail: r.detail }));
  }
}

export class VersionConflict extends Error {
  constructor(readonly currentVersion: number) { super(`The case was updated by another save (now version ${currentVersion}).`); }
}

function toCase(r: Record<string, unknown>): CaseRow {
  return { caseId: String(r.case_id), brandId: String(r.brand_id), marketplace: String(r.marketplace),
    periodStart: day(r.period_start), periodEnd: day(r.period_end), createdAt: iso(r.created_at) };
}
function toDecision(r: Record<string, unknown>): DecisionRow {
  return { decisionId: String(r.decision_id), caseId: String(r.case_id), version: Number(r.version),
    outcome: r.outcome as DecisionOutcome, budgetChangePct: Number(r.budget_change_pct), reason: String(r.reason),
    reviewer: String(r.reviewer), evidenceFingerprint: String(r.evidence_fingerprint), evidence: r.evidence, createdAt: iso(r.created_at) };
}
