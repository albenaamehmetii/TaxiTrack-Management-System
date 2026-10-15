ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS distance_source VARCHAR(16)
    CHECK (distance_source IS NULL OR distance_source = 'osrm');
