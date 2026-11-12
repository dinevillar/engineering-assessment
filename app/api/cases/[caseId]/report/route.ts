import { NextResponse } from 'next/server';
import { getService, handle } from '../../../../lib/server.ts';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Generates the client report from the latest decision (refused if evidence changed). */
export async function POST(_: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return handle(service => service.generateReport(caseId), 201);
}

/** Downloads the latest generated report as Markdown. */
export async function GET(_: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const service = await getService();
  const report = await service.store.latestReport(caseId);
  if (!report) return NextResponse.json({ error: { code: 'NO_REPORT', message: 'No report has been generated for this case.', details: [] } }, { status: 404 });
  return new NextResponse(report.markdown, { headers: {
    'content-type': 'text/markdown; charset=utf-8',
    'content-disposition': `attachment; filename="${caseId}-client-report.md"`,
  } });
}
