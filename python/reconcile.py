"""Weekly source-to-mart reconciliation. JSON evidence in, evidence + quality out.

Publisher exports are authoritative. For each week the authoritative figure is the
publisher's current report (`publisherCurrent`), verified against its own offer rows.
The pipeline figure (`activeSubscriptions` / `previousSubscriptions`) is compared with it.
Growth is only reported as comparable when both weeks are complete full-week snapshots.
"""
import json
import sys
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

MAX_IMPORT_AGE_SECONDS = 48 * 3600


def _pct(current, previous):
    if current is None or previous is None or previous <= 0:
        return None
    return float(((Decimal(current) / Decimal(previous) - 1) * 100).quantize(
        Decimal('0.01'), rounding=ROUND_HALF_UP))


def _issue(issues, code, severity, week, message, source_ids):
    issues.append({'code': code, 'severity': severity, 'week': week,
                   'message': message, 'sourceIds': [s for s in source_ids if s]})


def _week(evidence, week, issues):
    """Return the authoritative figure for a week (or None) and record issues."""
    label = 'Reporting week' if week == 'current' else 'Comparison week'
    start = evidence['periodStart'] if week == 'current' else evidence['previousPeriodStart']
    expected_end = evidence['expectedPeriodEnd'] if week == 'current' else evidence['previousExpectedPeriodEnd']
    pipeline = evidence['activeSubscriptions'] if week == 'current' else evidence['previousSubscriptions']
    snapshots = [s for s in evidence.get('sourceSnapshots', []) if s['week'] == week]
    selected = [s for s in snapshots if s.get('selected')]
    publisher = next((p for p in evidence.get('publisherCurrent', []) if p['week'] == week), None)

    if publisher is None:
        _issue(issues, 'publisher_report_missing', 'blocking', week,
               f'{label} ({start}): the publisher export has no report for this scope. '
               'The figure cannot be verified; missing data is unknown, not zero.',
               [s['publisherReportId'] for s in selected])
        if pipeline is None:
            _issue(issues, 'pipeline_report_missing', 'blocking', week,
                   f'{label} ({start}): no imported report is available.', [])
        return None, None

    pid = publisher['publisherReportId']
    if publisher['offerRows'] != publisher['offerCount'] or publisher['offerSum'] != publisher['activeSubscriptions']:
        _issue(issues, 'publisher_export_inconsistent', 'blocking', week,
               f'{label}: publisher report {pid} header ({publisher["offerCount"]} offers, '
               f'{publisher["activeSubscriptions"]:,} subscriptions) does not match its offer rows '
               f'({publisher["offerRows"]} offers, {publisher["offerSum"]:,}).', [pid])
        return None, publisher

    authoritative = publisher['offerSum']
    if publisher['status'] != 'complete' or publisher['periodEnd'] < expected_end:
        _issue(issues, 'incomplete_period', 'blocking', week,
               f'{label} is incomplete: the latest publisher report {pid} is {publisher["status"]} and covers '
               f'{start} to {publisher["periodEnd"]} (expected through {expected_end}). '
               'It is not comparable with a full week.', [pid])

    if not selected:
        _issue(issues, 'pipeline_report_missing', 'blocking', week,
               f'{label}: the internal pipeline has no imported report; the publisher reports '
               f'{authoritative:,} in {pid}. Re-import before relying on the pipeline.', [pid])
        return authoritative, publisher

    chosen = selected[0]
    chosen_ids = [chosen['reportId'], chosen['publisherReportId']]
    if chosen['publisherReportId'] != pid:
        exported = chosen.get('exported')
        why = ('is not in the publisher export' if exported is None
               else f'was superseded by {exported["supersededBy"]}' if exported.get('supersededBy')
               else 'is not the publisher\'s current report')
        _issue(issues, 'superseded_report_selected', 'corrected', week,
               f'{label}: the pipeline used {chosen["reportId"]} ({chosen["publisherReportId"]}), which {why}. '
               f'The publisher\'s current report is {pid} ({authoritative:,}).', chosen_ids + [pid])
    elif chosen['loadedOffers'] != publisher['offerCount'] or chosen['activeSubscriptions'] != authoritative:
        _issue(issues, 'incomplete_import', 'corrected', week,
               f'{label}: import {chosen["reportId"]} loaded {chosen["loadedOffers"]} of {publisher["offerCount"]} '
               f'offers ({chosen["activeSubscriptions"]:,} vs {authoritative:,} published). '
               'The publisher figure is used; the import must be re-run.', chosen_ids)
    if chosen['declaredOffers'] != chosen['loadedOffers'] or chosen['declaredSubscriptions'] != chosen['activeSubscriptions']:
        if not any(i['code'] == 'incomplete_import' and i['week'] == week for i in issues):
            _issue(issues, 'import_control_total_mismatch', 'warning', week,
                   f'{label}: import {chosen["reportId"]} header declares {chosen["declaredOffers"]} offers / '
                   f'{chosen["declaredSubscriptions"]:,} but {chosen["loadedOffers"]} / '
                   f'{chosen["activeSubscriptions"]:,} were loaded.', chosen_ids)
    if pipeline is not None and pipeline != chosen['activeSubscriptions']:
        _issue(issues, 'mart_mismatch', 'blocking', week,
               f'{label}: weekly mart shows {pipeline:,} but its source report holds '
               f'{chosen["activeSubscriptions"]:,}.', chosen_ids)
    return authoritative, publisher


def reconcile(evidence):
    evidence = dict(evidence)
    issues = []
    current, cur_pub = _week(evidence, 'current', issues)
    previous, prev_pub = _week(evidence, 'previous', issues)

    evidence['sourceTotal'] = current
    evidence['previousSourceTotal'] = previous
    pipe_cur, pipe_prev = evidence['activeSubscriptions'], evidence['previousSubscriptions']
    evidence['reconciliationDelta'] = None if pipe_cur is None or current is None else pipe_cur - current
    evidence['previousReconciliationDelta'] = None if pipe_prev is None or previous is None else pipe_prev - previous

    imported = evidence['ingestedAt']
    age = ((datetime.fromisoformat(evidence['asOf'].replace('Z', '+00:00'))
            - datetime.fromisoformat(imported.replace('Z', '+00:00'))).total_seconds()
           if imported else float('inf'))
    if age > MAX_IMPORT_AGE_SECONDS:
        _issue(issues, 'stale_import', 'blocking', 'current',
               'Latest import is unavailable or older than 48 hours.', evidence.get('sourceReports', []))

    evidence['observedChangePct'] = _pct(current, previous)
    if previous == 0:
        _issue(issues, 'zero_baseline', 'blocking', 'previous',
               'Comparison week has zero active subscriptions; percentage change is undefined.', [])
    blocking = [i for i in issues if i['severity'] == 'blocking']
    evidence['growthPct'] = evidence['observedChangePct'] if not blocking else None
    quality = {'status': 'insufficient' if blocking else 'ready',
               'reasons': [i['message'] for i in blocking], 'issues': issues}
    return {'evidence': evidence, 'quality': quality}


if __name__ == '__main__':
    json.dump(reconcile(json.load(sys.stdin)), sys.stdout, allow_nan=False)
