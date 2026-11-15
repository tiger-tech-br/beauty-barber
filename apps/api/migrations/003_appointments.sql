-- Agenda multiempresa com prevenção de conflitos no próprio PostgreSQL.
-- btree_gist foi habilitada pela migration 002_management.sql.

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  professional_id UUID NOT NULL,
  service_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 10000000),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
  notes VARCHAR(500),
  created_by_user_id UUID,
  public_cancel_token_hash CHAR(64) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (ends_at <= starts_at + INTERVAL '10 hours'),
  UNIQUE (establishment_id, id),
  FOREIGN KEY (establishment_id, professional_id)
    REFERENCES professionals(establishment_id, id),
  FOREIGN KEY (establishment_id, service_id)
    REFERENCES services(establishment_id, id),
  FOREIGN KEY (establishment_id, customer_id)
    REFERENCES customers(establishment_id, id),
  FOREIGN KEY (establishment_id, created_by_user_id)
    REFERENCES memberships(establishment_id, user_id),
  CONSTRAINT appointments_no_professional_overlap EXCLUDE USING gist (
    establishment_id WITH =,
    professional_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('pending', 'confirmed', 'in_progress'))
);

CREATE INDEX appointments_establishment_start_idx
  ON appointments(establishment_id, starts_at);
CREATE INDEX appointments_customer_history_idx
  ON appointments(establishment_id, customer_id, starts_at DESC);

CREATE TABLE appointment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  actor_user_id UUID,
  event VARCHAR(24) NOT NULL CHECK (event IN ('created', 'status_changed', 'rescheduled')),
  previous_status VARCHAR(24),
  current_status VARCHAR(24) NOT NULL,
  previous_starts_at TIMESTAMPTZ,
  current_starts_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (establishment_id, appointment_id)
    REFERENCES appointments(establishment_id, id) ON DELETE CASCADE,
  FOREIGN KEY (establishment_id, actor_user_id)
    REFERENCES memberships(establishment_id, user_id)
);

CREATE INDEX appointment_history_appointment_idx
  ON appointment_history(establishment_id, appointment_id, created_at);

