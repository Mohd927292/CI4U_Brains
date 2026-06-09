ALTER TABLE public.follow_ups
  ADD COLUMN IF NOT EXISTS snooze_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snoozed_until timestamp(3),
  ADD COLUMN IF NOT EXISTS last_alerted_at timestamp(3);

CREATE INDEX IF NOT EXISTS follow_ups_alert_snooze_idx
  ON public.follow_ups(data_scope, assigned_to_id, snoozed_until, status);
