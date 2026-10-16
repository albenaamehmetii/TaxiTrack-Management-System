ALTER TABLE driver_applications
  DROP COLUMN IF EXISTS vehicle_make,
  DROP COLUMN IF EXISTS vehicle_model;
