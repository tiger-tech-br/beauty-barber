-- Gestão inicial do estabelecimento. Todas as entidades pertencem a uma empresa.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(24) NOT NULL CHECK (category IN ('cabelo', 'barba', 'unhas', 'estetica', 'personalizada')),
  description VARCHAR(500),
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 10000000),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, id)
);

CREATE INDEX services_establishment_name_idx ON services(establishment_id, name);

CREATE TABLE professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  full_name VARCHAR(120) NOT NULL,
  specialty VARCHAR(120),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, id)
);

CREATE INDEX professionals_establishment_name_idx ON professionals(establishment_id, full_name);

CREATE TABLE professional_services (
  establishment_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  service_id UUID NOT NULL,
  PRIMARY KEY (establishment_id, professional_id, service_id),
  FOREIGN KEY (establishment_id, professional_id)
    REFERENCES professionals(establishment_id, id) ON DELETE CASCADE,
  FOREIGN KEY (establishment_id, service_id)
    REFERENCES services(establishment_id, id) ON DELETE CASCADE
);

CREATE TABLE working_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute SMALLINT NOT NULL CHECK (end_minute BETWEEN 1 AND 1439),
  CHECK (start_minute < end_minute),
  FOREIGN KEY (establishment_id, professional_id)
    REFERENCES professionals(establishment_id, id) ON DELETE CASCADE,
  EXCLUDE USING gist (
    establishment_id WITH =,
    professional_id WITH =,
    weekday WITH =,
    int4range(start_minute, end_minute, '[)') WITH &&
  )
);

CREATE INDEX working_hours_professional_idx ON working_hours(establishment_id, professional_id, weekday);

CREATE TABLE schedule_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  begins_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR(160),
  CHECK (begins_at < ends_at),
  FOREIGN KEY (establishment_id, professional_id)
    REFERENCES professionals(establishment_id, id) ON DELETE CASCADE
);

CREATE INDEX schedule_blocks_professional_period_idx
  ON schedule_blocks(establishment_id, professional_id, begins_at);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(25),
  notes VARCHAR(500),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (establishment_id, id)
);

CREATE INDEX customers_establishment_name_idx ON customers(establishment_id, full_name);

