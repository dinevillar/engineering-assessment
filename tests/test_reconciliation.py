import copy

from reconcile import reconcile


def snapshot(week, report_id, subs, *, status='complete', period_end, offers=120, declared=None, selected=True):
    return dict(week=week, reportId=report_id, publisherReportId=f'pub-{report_id}', revision=1,
                status=status, periodEnd=period_end, generatedAt='2026-10-06T02:00:00Z',
                extractedAt='2026-10-06T03:00:00Z', loadedOffers=offers, activeSubscriptions=subs,
                declaredOffers=120, declaredSubscriptions=subs if declared is None else declared,
                selected=selected, exported=None)


def publisher(week, report_id, subs, *, status='complete', period_end, offers=120, offer_sum=None):
    return dict(week=week, publisherReportId=f'pub-{report_id}', status=status, periodEnd=period_end,
                generatedAt='2026-10-06T02:00:00Z', offerCount=120, activeSubscriptions=subs,
                offerRows=offers, offerSum=subs if offer_sum is None else offer_sum)


def example():
    return dict(activeSubscriptions=115, previousSubscriptions=100,
                sourceSnapshots=[snapshot('current', 'cur', 115, period_end='2026-10-04'),
                                 snapshot('previous', 'prev', 100, period_end='2026-09-27')],
                publisherCurrent=[publisher('current', 'cur', 115, period_end='2026-10-04'),
                                  publisher('previous', 'prev', 100, period_end='2026-09-27')],
                sourceReports=['cur'], sourceComplete=True, sourcePeriodEnd='2026-10-04',
                previousSourceComplete=True, previousSourcePeriodEnd='2026-09-27',
                periodStart='2026-09-28', expectedPeriodEnd='2026-10-04',
                previousPeriodStart='2026-09-21', previousExpectedPeriodEnd='2026-09-27',
                asOf='2026-10-06T12:00:00Z', ingestedAt='2026-10-06T03:00:00+00:00')


def codes(result):
    return {(i['code'], i['severity']) for i in result['quality']['issues']}


def test_complete_comparable_snapshots():
    result = reconcile(example())
    assert result['evidence']['growthPct'] == 15
    assert result['evidence']['sourceTotal'] == 115
    assert result['evidence']['reconciliationDelta'] == 0
    assert result['quality']['status'] == 'ready'
    assert result['quality']['issues'] == []


def test_missing_import_is_visible():
    evidence = example()
    evidence['ingestedAt'] = None
    result = reconcile(evidence)
    assert result['quality']['status'] == 'insufficient'
    assert ('stale_import', 'blocking') in codes(result)


def test_zero_baseline_has_no_percentage_growth():
    evidence = example()
    evidence['previousSubscriptions'] = 0
    evidence['sourceSnapshots'][1]['activeSubscriptions'] = 0
    evidence['sourceSnapshots'][1]['declaredSubscriptions'] = 0
    evidence['publisherCurrent'][1].update(activeSubscriptions=0, offerSum=0)
    assert reconcile(evidence)['evidence']['growthPct'] is None


def test_partial_current_week_blocks_growth_but_keeps_observed_change():
    evidence = example()
    evidence['sourceSnapshots'][0].update(status='partial', periodEnd='2026-10-02')
    evidence['publisherCurrent'][0].update(status='partial', periodEnd='2026-10-02')
    result = reconcile(evidence)
    assert result['quality']['status'] == 'insufficient'
    assert ('incomplete_period', 'blocking') in codes(result)
    assert result['evidence']['growthPct'] is None
    assert result['evidence']['observedChangePct'] == 15


def test_truncated_import_is_corrected_from_publisher_export():
    evidence = example()
    evidence['previousSubscriptions'] = 80
    evidence['sourceSnapshots'][1].update(loadedOffers=100, activeSubscriptions=80)
    result = reconcile(evidence)
    assert ('incomplete_import', 'corrected') in codes(result)
    assert result['evidence']['previousSourceTotal'] == 100
    assert result['evidence']['previousReconciliationDelta'] == -20
    assert result['evidence']['growthPct'] == 15  # computed from the publisher figure, not 115/80


def test_superseded_selection_uses_publisher_current_report():
    evidence = example()
    evidence['sourceSnapshots'][0]['publisherReportId'] = 'pub-old'
    evidence['sourceSnapshots'][0]['exported'] = dict(status='complete', periodEnd='2026-10-04',
                                                      supersededBy='pub-cur', offerCount=120,
                                                      activeSubscriptions=130, offerRows=120, offerSum=130)
    result = reconcile(evidence)
    assert ('superseded_report_selected', 'corrected') in codes(result)
    assert result['evidence']['sourceTotal'] == 115


def test_missing_publisher_report_is_unknown_not_zero():
    evidence = example()
    evidence['publisherCurrent'] = evidence['publisherCurrent'][1:]
    result = reconcile(evidence)
    assert ('publisher_report_missing', 'blocking') in codes(result)
    assert result['evidence']['sourceTotal'] is None
    assert result['evidence']['growthPct'] is None


def test_inconsistent_publisher_export_is_blocking():
    evidence = copy.deepcopy(example())
    evidence['publisherCurrent'][0]['offerSum'] = 110
    result = reconcile(evidence)
    assert ('publisher_export_inconsistent', 'blocking') in codes(result)
    assert result['quality']['status'] == 'insufficient'
