import { handle, readJson } from '../../../../lib/server.ts';
import type { DecisionInput } from '../../../../../src/review/service.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Saves a decision. Validation (unsupported approval, stale evidence, etc.) happens in ReviewService. */
export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handle(async service => service.saveDecision(caseId, (await readJson(request)) as unknown as DecisionInput), 201);
}
