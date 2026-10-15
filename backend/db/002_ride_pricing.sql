ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS base_price NUMERIC(10, 2)
    CHECK (base_price IS NULL OR base_price >= 0),
  ADD COLUMN IF NOT EXISTS price_per_km NUMERIC(10, 2)
    CHECK (price_per_km IS NULL OR price_per_km >= 0);
