ALTER TABLE driver_notifications
  DROP CONSTRAINT IF EXISTS driver_notifications_notification_type_check;

ALTER TABLE driver_notifications
  ADD CONSTRAINT driver_notifications_notification_type_check
  CHECK (notification_type IN ('new_ride_request', 'ride_cancelled', 'new_rating_received'));

ALTER TABLE driver_notifications
  ADD COLUMN IF NOT EXISTS rating_id BIGINT REFERENCES ride_ratings(ride_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS driver_notifications_rating_id_unique
  ON driver_notifications (rating_id)
  WHERE rating_id IS NOT NULL;
