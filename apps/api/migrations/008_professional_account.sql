-- Uma pessoa da equipe pode visualizar somente a agenda do profissional associado à sua conta.
-- A FK composta impede associar um usuário que pertença somente a outra empresa.
ALTER TABLE professionals
  ADD COLUMN user_id UUID,
  ADD CONSTRAINT professionals_user_membership_fk
    FOREIGN KEY (establishment_id, user_id)
    REFERENCES memberships(establishment_id, user_id) ON DELETE SET NULL (user_id);

CREATE UNIQUE INDEX professionals_one_user_per_establishment_idx
  ON professionals(establishment_id, user_id) WHERE user_id IS NOT NULL;
