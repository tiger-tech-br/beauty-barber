-- Exceções pontuais: cada empresa pode fechar ou alterar os horários de uma data.
-- O expediente semanal permanece intacto.
CREATE TABLE establishment_special_hours (
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  closed BOOLEAN NOT NULL,
  periods JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(establishment_id,day),
  CHECK (jsonb_typeof(periods)='array'),
  CHECK (NOT closed OR jsonb_array_length(periods)=0),
  CHECK (closed OR jsonb_array_length(periods)>0)
);
