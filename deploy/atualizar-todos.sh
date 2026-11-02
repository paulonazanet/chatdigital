#!/usr/bin/env bash
# Atualiza o código e reinicia todos os clientes deste servidor (E5: um código só).
#   sudo /opt/chatdigital/app/deploy/atualizar-todos.sh
# Antes: cópia do banco de cada cliente (data/antes-da-atualizacao.db). Depois: lista como ficou.
set -euo pipefail
APP=/opt/chatdigital/app
CLIENTES=/opt/chatdigital/clientes
[ "$(id -u)" -eq 0 ] || { echo "rode com sudo" >&2; exit 1; }

cd "$APP"
[ -f data/chatdigital.db ] && sudo -u chatdigital cp data/chatdigital.db data/antes-da-atualizacao.db
for db in "$CLIENTES"/*/data/chatdigital.db; do
  [ -e "$db" ] && sudo -u chatdigital cp "$db" "$(dirname "$db")/antes-da-atualizacao.db"
done

antes=$(sudo -u chatdigital git rev-parse HEAD)
sudo -u chatdigital git pull --ff-only
if ! sudo -u chatdigital git diff --quiet "$antes" HEAD -- package-lock.json; then
  sudo -u chatdigital npm ci --omit=dev
fi
# o modelo do serviço pode ter mudado
if ! cmp -s deploy/chatdigital@.service /etc/systemd/system/chatdigital@.service 2>/dev/null && ls "$CLIENTES"/*/.env >/dev/null 2>&1; then
  cp deploy/chatdigital@.service /etc/systemd/system/chatdigital@.service
  systemctl daemon-reload
fi

systemctl is-enabled chatdigital >/dev/null 2>&1 && systemctl restart chatdigital
for env in "$CLIENTES"/*/.env; do
  [ -e "$env" ] && systemctl restart "chatdigital@$(basename "$(dirname "$env")")"
done
echo "Versão: $(sudo -u chatdigital git log -1 --format='%h %s')"
sleep 8
"$APP/deploy/listar-clientes.sh"
