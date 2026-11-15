-- Perfil comercial e fluxos seguros de convite e recuperação de senha.
ALTER TABLE establishments
  ADD COLUMN contact_email VARCHAR(255),
  ADD COLUMN contact_phone VARCHAR(25),
  ADD COLUMN address_line VARCHAR(240),
  ADD COLUMN city VARCHAR(100),
  ADD COLUMN state_code CHAR(2);

CREATE TABLE team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  establishment_id UUID NOT NULL REFERENCES establishments(id) ON DELETE CASCADE,
  invited_by_user_id UUID NOT NULL,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(24) NOT NULL CHECK (role IN ('receptionist','professional')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (establishment_id,invited_by_user_id)
    REFERENCES memberships(establishment_id,user_id),
  CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX team_invitations_establishment_idx ON team_invitations(establishment_id,created_at DESC);
CREATE UNIQUE INDEX team_invitations_one_pending_idx
  ON team_invitations(establishment_id,email)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens(user_id,created_at DESC);
