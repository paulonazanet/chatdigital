#!/usr/bin/env bash
# Lista os clientes deste servidor: nome, porta, serviço e o que a página de verificação diz.
#   /opt/chatdigital/app/deploy/listar-clientes.sh
set -uo pipefail
CLIENTES=/opt/chatdigital/clientes
printf '%-16s %-6s %-10s %s\n' CLIENTE PORTA SERVICO SAUDE
if systemctl list-unit-files chatdigital.service >/dev/null 2>&1 && systemctl is-enabled chatdigital >/dev/null 2>&1; then
  printf '%-16s %-6s %-10s %s\n' "(nazagas antiga)" 3001 "$(systemctl is-active chatdigital)" "$(curl -fsS -m 5 http://127.0.0.1:3001/saude 2>/dev/null || echo '-')"
fi
for env in "$CLIENTES"/*/.env; do
  [ -e "$env" ] || continue
  nome=$(basename "$(dirname "$env")")
  porta=$(grep '^PORTA=' "$env" | cut -d= -f2)
  printf '%-16s %-6s %-10s %s\n' "$nome" "$porta" "$(systemctl is-active "chatdigital@$nome")" "$(curl -fsS -m 5 "http://127.0.0.1:$porta/saude" 2>/dev/null || echo '-')"
done
