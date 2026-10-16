ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS rating_skipped_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS driver_notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  notification_type VARCHAR(32) NOT NULL CHECK (notification_type IN ('ride_cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  UNIQUE (ride_id, driver_id, notification_type)
);

CREATE INDEX IF NOT EXISTS driver_notifications_unread_idx
  ON driver_notifications (driver_id, created_at)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS ride_ratings (
  ride_id BIGINT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  client_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  driver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ride_ratings_driver_created_idx
  ON ride_ratings (driver_id, created_at DESC);
