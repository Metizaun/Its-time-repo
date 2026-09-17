-- A manual dead-letter retry resets outbox.attempt_count to start a new delivery
-- window. Keep its historical delivery records without treating that new window's
-- attempt number as a duplicate of the previous one.
BEGIN;

ALTER TABLE agenda_sync.deliveries
  DROP CONSTRAINT agenda_deliveries_attempt_unique;

ALTER TABLE agenda_sync.deliveries
  ADD CONSTRAINT agenda_deliveries_attempt_started_unique
  UNIQUE (outbox_id, attempt_number, started_at);

COMMENT ON CONSTRAINT agenda_deliveries_attempt_started_unique ON agenda_sync.deliveries IS
  'Attempt numbers may repeat after a manual dead-letter retry; started_at identifies the delivery execution.';

COMMIT;
