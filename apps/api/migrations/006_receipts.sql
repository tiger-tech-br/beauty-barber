-- Entradas registradas manualmente por usuários do estabelecimento.
-- Não processa cobranças nem registra pagamentos de assinatura do PagBank.
CREATE TABLE payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 10000000),
  method VARCHAR(16) NOT NULL CHECK (method IN ('cash', 'pix', 'card', 'transfer', 'other')),
  status VARCHAR(16) NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'voided')),
  notes VARCHAR(300),
  created_by_user_id UUID NOT NULL,
  voided_by_user_id UUID,
  void_reason VARCHAR(300),
  voided_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (establishment_id, appointment_id) REFERENCES appointments(establishment_id, id),
  FOREIGN KEY (establishment_id, created_by_user_id) REFERENCES memberships(establishment_id, user_id),
  FOREIGN KEY (establishment_id, voided_by_user_id) REFERENCES memberships(establishment_id, user_id),
  CHECK ((status='recorded' AND voided_at IS NULL) OR (status='voided' AND voided_at IS NOT NULL))
);
CREATE INDEX payment_records_period_idx ON payment_records(establishment_id,received_at DESC);
CREATE INDEX payment_records_appointment_idx ON payment_records(establishment_id,appointment_id);
