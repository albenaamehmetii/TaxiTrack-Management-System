ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_distance_source_check;
ALTER TABLE rides
  ADD CONSTRAINT rides_distance_source_check
    CHECK (distance_source IS NULL OR distance_source IN ('osrm', 'gps_trace'));

CREATE TABLE IF NOT EXISTS ride_locations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m DOUBLE PRECISION NOT NULL CHECK (accuracy_m >= 0),
  speed_mps DOUBLE PRECISION CHECK (speed_mps IS NULL OR speed_mps >= 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ride_locations_ride_recorded_idx
  ON ride_locations (ride_id, recorded_at, id);
