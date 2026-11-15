-- Horários escolhidos pelo próprio estabelecimento. Ausência de período = fechado.
-- O expediente do profissional é sempre limitado por esses horários.
CREATE TABLE establishment_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute SMALLINT NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute SMALLINT NOT NULL CHECK (end_minute BETWEEN 1 AND 1439),
  CHECK (start_minute < end_minute),
  EXCLUDE USING gist (
    establishment_id WITH =,
    weekday WITH =,
    int4range(start_minute, end_minute, '[)') WITH &&
  )
);

CREATE INDEX establishment_hours_establishment_idx ON establishment_hours(establishment_id,weekday);
