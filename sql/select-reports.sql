-- Exactly one report per brand/marketplace/week. A report is a snapshot, never an increment,
-- so revisions must not be summed. Precedence: complete before partial, then greatest
-- period_end, then the publisher's generation order (generated_at), then our import revision.
-- generated_at precedes revision because revision is only our import counter: a late
-- re-import of an older publisher report receives a higher revision but is superseded at
-- the publisher (publisher exports are authoritative).
WITH ranked AS (
  SELECT r.*, ROW_NUMBER() OVER (
    PARTITION BY brand_id, marketplace, period_start
    ORDER BY CASE WHEN status = 'complete' THEN 0 ELSE 1 END,
             period_end DESC, generated_at DESC, revision DESC
  ) AS priority
  FROM raw.subscription_reports r
  WHERE extracted_at <= $1::timestamptz AND generated_at <= $1::timestamptz
)
SELECT * FROM ranked WHERE priority = 1
