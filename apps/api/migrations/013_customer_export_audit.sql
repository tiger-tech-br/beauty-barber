-- Permite rastrear quais exportações do responsável foram feitas para um cliente específico.
-- O conteúdo do arquivo exportado e a senha de confirmação nunca são armazenados.
ALTER TABLE data_export_events ADD COLUMN customer_id UUID;

CREATE INDEX data_export_events_customer_idx
  ON data_export_events(establishment_id,customer_id,created_at DESC)
  WHERE customer_id IS NOT NULL;

