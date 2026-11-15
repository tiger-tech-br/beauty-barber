#!/usr/bin/env bash
# Backup lógico do PostgreSQL que roda no Docker Compose da VPS.
# Uso na raiz do projeto: bash scripts/backup-db.sh [diretorio-de-saida]
set -euo pipefail
umask 077

if [[ ! -f compose.yaml ]]; then
  echo 'Execute este script na raiz do projeto BeautyBarber (onde fica compose.yaml).' >&2
  exit 1
fi

backup_dir="${1:-backups}"
mkdir -p -- "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="${backup_dir%/}/beautybarber-${timestamp}.dump"
if [[ -e "$backup_path" ]]; then
  echo 'Já existe um backup com essa data e hora. Tente novamente em alguns segundos.' >&2
  exit 1
fi
temporary_path="$(mktemp "${backup_dir%/}/.beautybarber-XXXXXX.tmp")"
trap 'rm -f -- "$temporary_path"' EXIT

# O arquivo é criado na VPS, sem abrir o banco na internet e sem imprimir a senha.
docker compose exec -T db sh -c 'exec pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$temporary_path"

if [[ ! -s "$temporary_path" ]]; then
  echo 'O arquivo de backup está vazio. Operação interrompida.' >&2
  exit 1
fi

# Inspeciona a estrutura do arquivo; NÃO substitui o teste de restauração.
docker compose exec -T db pg_restore --list < "$temporary_path" > /dev/null
mv -- "$temporary_path" "$backup_path"
trap - EXIT
printf 'Backup criado: %s\n' "$backup_path"
printf 'IMPORTANTE: copie o arquivo para um destino externo à VPS e teste a restauração regularmente.\n'
