import { handle } from '../../../lib/server.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Reopens a saved case and re-validates it against current evidence. */
export async function GET(_: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handle(service => service.getCase(caseId));
}
