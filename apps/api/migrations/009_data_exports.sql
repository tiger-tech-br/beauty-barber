-- Auditoria de exportações de dados operacionais do estabelecimento.
-- O conteúdo exportado NÃO fica armazenado no banco ou em logs.
CREATE TABLE data_export_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL,
  requested_by_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (establishment_id, requested_by_user_id)
    REFERENCES memberships(establishment_id, user_id) ON DELETE CASCADE
);

CREATE INDEX data_export_events_establishment_idx
  ON data_export_events(establishment_id, created_at DESC);
