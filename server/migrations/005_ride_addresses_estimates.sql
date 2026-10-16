ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS pickup_address VARCHAR(300),
  ADD COLUMN IF NOT EXISTS destination_address VARCHAR(300),
  ADD COLUMN IF NOT EXISTS estimated_distance_km NUMERIC(10, 3)
    CHECK (estimated_distance_km IS NULL OR estimated_distance_km > 0),
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes INTEGER
    CHECK (estimated_duration_minutes IS NULL OR estimated_duration_minutes >= 0);
