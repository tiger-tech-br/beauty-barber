-- Assinaturas pagas por links recorrentes do PagBank.
-- O link é compartilhado e NÃO identifica automaticamente o estabelecimento pagador.
-- Por isso, a ativação é uma decisão auditada de um administrador da plataforma.

CREATE TABLE subscription_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL,
  billing_cycle VARCHAR(12) NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  billing_email VARCHAR(255),
  external_reference VARCHAR(120),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note VARCHAR(400),
  reviewed_by_user_id UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (establishment_id,id),
  FOREIGN KEY (establishment_id, requested_by_user_id)
    REFERENCES memberships(establishment_id, user_id),
  CHECK ((status = 'pending' AND reviewed_at IS NULL) OR (status <> 'pending' AND reviewed_at IS NOT NULL))
);

CREATE INDEX subscription_requests_establishment_idx
  ON subscription_requests(establishment_id, created_at DESC);
CREATE INDEX subscription_requests_pending_idx
  ON subscription_requests(created_at) WHERE status = 'pending';
CREATE UNIQUE INDEX subscription_requests_one_pending_idx
  ON subscription_requests(establishment_id) WHERE status = 'pending';

CREATE TABLE subscriptions (
  establishment_id UUID PRIMARY KEY REFERENCES establishments(id) ON DELETE CASCADE,
  billing_cycle VARCHAR(12) NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  status VARCHAR(16) NOT NULL CHECK (status IN ('active', 'suspended', 'cancelled', 'expired')),
  external_reference VARCHAR(120),
  active_since TIMESTAMPTZ NOT NULL,
  paid_through TIMESTAMPTZ NOT NULL,
  verified_by_user_id UUID NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (paid_through > active_since)
);

CREATE TABLE billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  request_id UUID,
  actor_user_id UUID REFERENCES users(id),
  event VARCHAR(32) NOT NULL CHECK (event IN ('checkout_started', 'verification_requested', 'request_approved', 'request_rejected', 'subscription_suspended', 'subscription_reactivated')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (establishment_id,request_id)
    REFERENCES subscription_requests(establishment_id,id)
);

CREATE INDEX billing_events_establishment_idx ON billing_events(establishment_id, created_at DESC);
