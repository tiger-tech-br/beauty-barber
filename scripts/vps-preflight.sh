#!/usr/bin/env bash
# Inventário somente de leitura antes de instalar o BeautyBarber numa VPS com PetCore.
# Não reinicia nem altera contêineres, redes, volumes, DNS ou arquivos.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker não encontrado. Nenhuma alteração foi feita.\n' >&2
  exit 1
fi

printf '\n[1/6] Projetos Docker Compose existentes\n'
docker compose ls --all

printf '\n[2/6] Contêineres e portas publicados\n'
docker ps --all --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

printf '\n[3/6] Volumes BeautyBarber já existentes\n'
for name in beautybarber_postgres_data beautybarber_caddy_data beautybarber_caddy_config; do
  if docker volume inspect "$name" >/dev/null 2>&1; then
    printf 'ATENÇÃO: o volume %s já existe. Inspecione antes de criar ou reutilizar.\n' "$name"
  else
    printf 'Livre: %s\n' "$name"
  fi
done

printf '\n[4/6] Rede BeautyBarber\n'
if docker network inspect beautybarber_private >/dev/null 2>&1; then
  printf 'ATENÇÃO: a rede beautybarber_private já existe. Inspecione antes de reutilizar.\n'
else
  printf 'Livre: beautybarber_private\n'
fi

printf '\n[5/6] Porta local planejada 18080 e proxy público\n'
if command -v ss >/dev/null 2>&1; then
  ss -ltn '( sport = :18080 or sport = :80 or sport = :443 )'
else
  printf 'Comando ss indisponível; verificar portas manualmente.\n'
fi

printf '\n[6/6] Recursos disponíveis\n'
if command -v free >/dev/null 2>&1; then free -h; fi
df -h /srv 2>/dev/null || df -h /

printf '\nInventário concluído sem alterações. Antes de publicar, confirme o proxy existente e o backup do PetCore.\n'
