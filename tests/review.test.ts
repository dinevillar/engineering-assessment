import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { openDatabase, ROOT } from '../src/database.ts';
import { ReviewStore } from '../src/review/store.ts';
import { ReviewError, ReviewService, type DecisionInput } from '../src/review/service.ts';

const HOLD_REASON = 'Current week is partial; hold until the complete publisher report arrives.';

async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof ReviewError && e.code === code);
}

describe('review cases on the bundled data', () => {
  let db: PGlite; let temp: string; let store: ReviewStore; let service: ReviewService;
  before(async () => {
    db = await openDatabase(true);
    temp = await mkdtemp(path.join(tmpdir(), 'review-store-'));
    store = await ReviewStore.open(path.join(temp, 'store'));
    service = new ReviewService(db, store);
  });
  after(async () => { await store.close(); await db.close(); await rm(temp, { recursive: true, force: true }); });

  test('every brand/marketplace scope in the data can be opened and evaluated', async () => {
    const scopes = await service.scopes();
    assert.ok(scopes.length >= 2 && new Set(scopes.map(s => s.marketplace)).size >= 2);
    for (const s of scopes) {
      const view = await service.openCase(s.brandId, s.marketplace);
      assert.equal(view.status, 'open');
      assert.match(view.evaluation.fingerprint, /^[0-9a-f]{16}$/);
      // The pipeline figure never exceeds what the publisher reports for its selected report.
      for (const w of view.evaluation.weeks) if (w.publisher !== null) assert.ok(w.pipeline === null || w.pipeline <= w.publisher);
    }
  });

  test('Cedar & Coast: the draft growth claim is unsupported and approval is rejected by the backend', async () => {
    const view = await service.openCase('cedar-coast', 'US');
    const ev = view.evaluation;
    assert.equal(ev.weeks[0].draft, 24750);
    assert.equal(ev.weeks[0].publisher, 8400);
    assert.equal(ev.growth.comparable, false);
    assert.equal(ev.growth.verifiedPct, null);
    assert.ok(ev.issues.some(i => i.code === 'incomplete_period' && i.severity === 'blocking'));
    assert.equal(ev.model.accepted, false);
    assert.equal(ev.policy.action, 'hold');
    assert.equal(view.options.find(o => o.outcome === 'approve_expansion')!.allowed, false);
    // Waiting for the publisher's complete week is not an internal data fix.
    assert.doesNotMatch(view.options.find(o => o.outcome === 'hold_pending_data')!.reason, /^Recommended/);

    const base: DecisionInput = { outcome: 'approve_expansion', reason: 'Client asked for the expansion in the handover.', evidenceFingerprint: ev.fingerprint, expectedVersion: 0, acknowledgeLimitations: true };
    await rejects(service.saveDecision(view.case.caseId, base), 'UNSUPPORTED_APPROVAL');
    await rejects(service.saveDecision(view.case.caseId, { ...base, outcome: 'hold', reason: 'short' }), 'REASON_REQUIRED');
    await rejects(service.saveDecision(view.case.caseId, { ...base, outcome: 'hold', reason: HOLD_REASON, acknowledgeLimitations: false }), 'LIMITATIONS_NOT_ACKNOWLEDGED');
    await rejects(service.saveDecision(view.case.caseId, { ...base, outcome: 'hold', reason: HOLD_REASON, evidenceFingerprint: 'stale' }), 'EVIDENCE_CHANGED');
    await rejects(service.generateReport(view.case.caseId), 'NO_DECISION');

    const saved = await service.saveDecision(view.case.caseId, { ...base, outcome: 'hold', reason: HOLD_REASON });
    assert.equal(saved.status, 'decided');
    assert.equal(saved.latestDecision!.version, 1);
    assert.equal(saved.latestDecision!.budgetChangePct, 0);
    assert.ok(saved.events.some(e => e.kind === 'decision_rejected'));
    await rejects(service.saveDecision(view.case.caseId, { ...base, outcome: 'hold', reason: HOLD_REASON }), 'VERSION_CONFLICT');

    const reported = await service.generateReport(view.case.caseId);
    assert.equal(reported.status, 'reported');
    const md = reported.latestReport!.markdown;
    assert.match(md, /8,400/);
    assert.match(md, /Not comparable/);
    assert.match(md, /Hold current promotion/);
    assert.doesNotMatch(md, /24,750|217/);
  });

  test('healthy control: verified complete growth of at least 10% can be approved at exactly 10%', async () => {
    const view = await service.openCase('lumen-home', 'US');
    assert.equal(view.evaluation.growth.comparable, true);
    assert.equal(view.evaluation.growth.verifiedPct, 15);
    assert.equal(view.evaluation.issues.length, 0);
    const input: DecisionInput = { outcome: 'approve_expansion', reason: 'Complete weeks reconcile with the publisher; growth 15%.', evidenceFingerprint: view.evaluation.fingerprint, expectedVersion: 0, acknowledgeLimitations: true };
    await rejects(service.saveDecision(view.case.caseId, { ...input, budgetChangePct: 20 }), 'UNSUPPORTED_APPROVAL');
    const saved = await service.saveDecision(view.case.caseId, input);
    assert.equal(saved.latestDecision!.outcome, 'approve_expansion');
    assert.equal(saved.latestDecision!.budgetChangePct, 10);
  });

  test('a truncated comparison-week import is corrected from the publisher export', async () => {
    const view = await service.openCase('moss-trail', 'US');
    const prev = view.evaluation.weeks[1];
    assert.equal(prev.pipeline, 5213);
    assert.equal(prev.publisher, 6300);
    assert.equal(view.evaluation.growth.verifiedPct, -3.17);
    assert.ok(view.evaluation.issues.some(i => i.code === 'incomplete_import' && i.week === 'previous'));
    assert.equal(view.evaluation.policy.action, 'hold');
  });
});

test('a saved case survives closing and reopening the store', async () => {
  const db = await openDatabase(true);
  const temp = await mkdtemp(path.join(tmpdir(), 'review-reopen-'));
  try {
    let store = await ReviewStore.open(path.join(temp, 'store'));
    let service = new ReviewService(db, store);
    const view = await service.openCase('orbit-pet', 'US');
    await service.saveDecision(view.case.caseId, { outcome: 'hold', reason: 'Flat week-over-week; nothing to expand on.', evidenceFingerprint: view.evaluation.fingerprint, expectedVersion: 0, acknowledgeLimitations: true });
    await service.generateReport(view.case.caseId);
    await store.close();

    store = await ReviewStore.open(path.join(temp, 'store'));
    service = new ReviewService(db, store);
    const reopened = await service.getCase(view.case.caseId);
    assert.equal(reopened.status, 'reported');
    assert.equal(reopened.latestDecision!.outcome, 'hold');
    assert.equal(reopened.latestDecision!.reason, 'Flat week-over-week; nothing to expand on.');
    const snapshot = reopened.latestDecision!.evidence as { sourceIds: string[]; calculation: string; limitations: string[] };
    assert.ok(snapshot.sourceIds.length >= 2);
    assert.match(snapshot.calculation, /5,100 \/ 5,100 − 1 = 0%/);
    assert.ok(snapshot.limitations.length > 0);
    assert.ok(reopened.latestReport);
    await store.close();
  } finally { await db.close(); await rm(temp, { recursive: true, force: true }); }
});

test('changed input: a newly published complete report marks the old decision as needing attention', async () => {
  const db = await openDatabase(true);
  const temp = await mkdtemp(path.join(tmpdir(), 'review-changed-'));
  const exportsDir = path.join(temp, 'exports');
  await cp(path.join(ROOT, 'data', 'exports'), exportsDir, { recursive: true });
  const store = await ReviewStore.open(path.join(temp, 'store'));
  try {
    const service = new ReviewService(db, store, { exportsDir });
    const view = await service.openCase('cedar-coast', 'US');
    const caseId = view.case.caseId;
    await service.saveDecision(caseId, { outcome: 'hold', reason: HOLD_REASON, evidenceFingerprint: view.evaluation.fingerprint, expectedVersion: 0, acknowledgeLimitations: true });

    // The publisher issues a complete report for the week (isolated copies only).
    const [latest] = (await db.query<{ report_id: string; publisher_report_id: string; revision: number }>(
      `SELECT report_id, publisher_report_id, revision FROM raw.subscription_reports WHERE brand_id='cedar-coast' AND marketplace='US' AND period_start='2026-09-28' ORDER BY revision DESC LIMIT 1`)).rows;
    const newPub = `${latest.publisher_report_id}-final`;
    const newId = `${latest.report_id}-final`;
    const offers = (await db.query<{ offer_id: string; asin: string; active_subscriptions: number }>(
      `SELECT offer_id, asin, active_subscriptions FROM raw.subscription_offers WHERE report_id=$1`, [latest.report_id])).rows
      .map(o => ({ ...o, active_subscriptions: Math.round(o.active_subscriptions * 1.1) }));
    const total = offers.reduce((s, o) => s + o.active_subscriptions, 0);
    await db.query(`INSERT INTO raw.subscription_reports (report_id, brand_id, marketplace, period_start, period_end, revision, status, extracted_at, publisher_report_id, generated_at, declared_offer_count, declared_active_subscriptions)
      VALUES ($1,'cedar-coast','US','2026-09-28','2026-10-04',$2,'complete','2026-10-06T08:00:00Z',$3,'2026-10-06T07:00:00Z',$4,$5)`, [newId, latest.revision + 1, newPub, offers.length, total]);
    for (const o of offers) await db.query(`INSERT INTO raw.subscription_offers VALUES ($1,$2,$3,$4)`, [newId, o.offer_id, o.asin, o.active_subscriptions]);
    const reportsCsv = path.join(exportsDir, 'subscription_reports.csv');
    const csv = (await readFile(reportsCsv, 'utf8')).split(/\r?\n/).filter(Boolean)
      .map(line => line.startsWith(`${latest.publisher_report_id},`) ? line.replace(/,,(\d+,\d+)$/, `,${newPub},$1`) : line);
    csv.push(`${newPub},cedar-coast,US,2026-09-28,2026-10-04,complete,2026-10-06T07:00:00Z,,${offers.length},${total}`);
    await writeFile(reportsCsv, csv.join('\n') + '\n');
    const offersCsv = path.join(exportsDir, 'subscription_offers.csv');
    await writeFile(offersCsv, (await readFile(offersCsv, 'utf8')).trimEnd() + '\n' + offers.map(o => `${newPub},${o.offer_id},${o.asin},${o.active_subscriptions}`).join('\n') + '\n');

    const changed = await service.getCase(caseId);
    assert.equal(changed.status, 'needs_attention');
    assert.match(changed.attention!, /8,400.*partial.*→.*complete/);
    assert.equal(changed.evaluation.growth.comparable, true);
    assert.equal(changed.evaluation.weeks[0].publisher, total);
    await rejects(service.generateReport(caseId), 'EVIDENCE_CHANGED');

    const redecided = await service.saveDecision(caseId, { outcome: 'hold', reason: 'Re-reviewed with the complete report; holding for one more week.', evidenceFingerprint: changed.evaluation.fingerprint, expectedVersion: 1, acknowledgeLimitations: true });
    assert.equal(redecided.status, 'decided');
    assert.equal(redecided.decisions.length, 2);
    assert.equal((await service.generateReport(caseId)).status, 'reported');
  } finally { await store.close(); await db.close(); await rm(temp, { recursive: true, force: true }); }
});
