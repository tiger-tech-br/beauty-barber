-- Solicitação de agendamento público: só ocupa um horário após verificar o e-mail.
-- Pedidos não verificados não reservam a agenda e expiram após 20 minutos.
CREATE TABLE public_booking_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  service_id UUID NOT NULL,
  professional_id UUID NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (establishment_id, service_id) REFERENCES services(establishment_id, id),
  FOREIGN KEY (establishment_id, professional_id) REFERENCES professionals(establishment_id, id)
);
CREATE INDEX public_booking_requests_establishment_email_idx
  ON public_booking_requests(establishment_id, customer_email, created_at DESC);
CREATE INDEX public_booking_requests_expiration_idx ON public_booking_requests(expires_at);
