-- Identidade visual própria de cada salão: bytes restritos a PNG pequeno.
-- O arquivo é armazenado no PostgreSQL exclusivo do BeautyBarber e segue seus backups.
ALTER TABLE establishments ADD COLUMN logo_png BYTEA;

