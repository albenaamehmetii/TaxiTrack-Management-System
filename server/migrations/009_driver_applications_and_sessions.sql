ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS driver_applications (
  driver_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone VARCHAR(30) NOT NULL,
  license_number VARCHAR(80) NOT NULL,
  vehicle_plate VARCHAR(20) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS driver_applications_status_idx
  ON driver_applications (status, submitted_at DESC);
