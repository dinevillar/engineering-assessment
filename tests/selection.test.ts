import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { openDatabase, rebuildMetrics } from '../src/database.ts';

let db: PGlite;
before(async () => { db = await openDatabase(true); await rebuildMetrics(db); });
after(async () => { await db.close(); });

interface MartRow { active_subscriptions: string; source_report_ids: string[]; source_complete: boolean }
async function mart(brand: string, marketplace: string, week: string): Promise<MartRow> {
  const { rows } = await db.query<MartRow>(
    `SELECT active_subscriptions::text, source_report_ids, source_complete FROM marts.subscription_weekly
     WHERE brand_id=$1 AND marketplace=$2 AND period_start=$3::date`, [brand, marketplace, week]);
  assert.equal(rows.length, 1);
  return rows[0];
}

test('every weekly snapshot comes from exactly one report (snapshots are not additive)', async () => {
  const { rows } = await db.query<{ n: number }>(
    `SELECT jsonb_array_length(source_report_ids) AS n FROM marts.subscription_weekly`);
  assert.ok(rows.length > 0);
  for (const row of rows) assert.equal(row.n, 1);
});

test('an all-partial week uses the latest partial report, not the sum of revisions', async () => {
  const row = await mart('cedar-coast', 'US', '2026-09-28');
  assert.deepEqual(row.source_report_ids, ['cedar-coast-w12-r3']);
  assert.equal(row.active_subscriptions, '8400');
  assert.equal(row.source_complete, false);
});

test('a late re-import of a superseded publisher report does not win over the newer publisher report', async () => {
  const row = await mart('harbor-pantry', 'CA', '2026-09-28');
  assert.deepEqual(row.source_report_ids, ['harbor-pantry-ca-w12-r4']);
  assert.equal(row.active_subscriptions, '3780');
});
