CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL CHECK (length(trim(full_name)) > 0),
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL CHECK (role IN ('client', 'driver', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

CREATE TABLE IF NOT EXISTS rides (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  driver_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  pickup_latitude DOUBLE PRECISION NOT NULL CHECK (pickup_latitude BETWEEN -90 AND 90),
  pickup_longitude DOUBLE PRECISION NOT NULL CHECK (pickup_longitude BETWEEN -180 AND 180),
  destination_latitude DOUBLE PRECISION NOT NULL CHECK (destination_latitude BETWEEN -90 AND 90),
  destination_longitude DOUBLE PRECISION NOT NULL CHECK (destination_longitude BETWEEN -180 AND 180),
  start_latitude DOUBLE PRECISION CHECK (start_latitude BETWEEN -90 AND 90),
  start_longitude DOUBLE PRECISION CHECK (start_longitude BETWEEN -180 AND 180),
  end_latitude DOUBLE PRECISION CHECK (end_latitude BETWEEN -90 AND 90),
  end_longitude DOUBLE PRECISION CHECK (end_longitude BETWEEN -180 AND 180),
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'in_progress', 'completed', 'cancelled')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  distance_km NUMERIC(10, 3) CHECK (distance_km IS NULL OR distance_km >= 0),
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  price NUMERIC(10, 2) CHECK (price IS NULL OR price >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((start_latitude IS NULL) = (start_longitude IS NULL)),
  CHECK ((end_latitude IS NULL) = (end_longitude IS NULL))
);

CREATE INDEX IF NOT EXISTS rides_client_id_idx ON rides (client_id);
CREATE INDEX IF NOT EXISTS rides_driver_id_idx ON rides (driver_id);
CREATE INDEX IF NOT EXISTS rides_status_idx ON rides (status);
CREATE INDEX IF NOT EXISTS rides_requested_at_idx ON rides (requested_at);
