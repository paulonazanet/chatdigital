#!/bin/bash
# Backup fora da VM (Parte N do INSTALACAO_eunodigital.md): copia para o Dropbox, criptografado
# (remote rclone "dropcrypt"), a Nazagás de antes da E5 e cada cliente de /opt/chatdigital/clientes.
# Por instalação: cópias diárias do banco, configuração, .env e a sessão do WhatsApp (auth* compactada,
# porque são milhares de arquivos pequenos). As mídias (uploads) não vão: ocupam muito e o Dropbox tem 2 GB.
# Instalar: sudo install -m 700 /opt/chatdigital/app/deploy/backup-chat.sh /usr/local/bin/backup-chat.sh
# cron (sudo crontab -e): 0 3 * * * /usr/local/bin/backup-chat.sh >> /var/log/backup-chat.log 2>&1
set -u
APP=/opt/chatdigital/app
CLIENTES=/opt/chatdigital/clientes
TMP=$(mktemp /var/tmp/auth-XXXXXX.tgz)
trap 'rm -f "$TMP"' EXIT
falhou=0

# $1 = pasta da instalação, $2 = onde fica no Dropbox ("" = raiz, como sempre foi a Nazagás)
copiar() {
  local pasta=$1 destino=$2 auths
  rclone copy "$pasta/data/backups" "dropcrypt:${destino}data-backups" || return 1
  rclone copy "$pasta/config" "dropcrypt:${destino}config" --exclude "modelos/**" || return 1
  auths=$(cd "$pasta" && ls -d auth* 2>/dev/null)
  if [ -n "$auths" ]; then
    # shellcheck disable=SC2086
    tar czf "$TMP" -C "$pasta" $auths || return 1
    rclone copyto "$TMP" "dropcrypt:${destino}auth/auth-$(date +%F).tgz" || return 1
  fi
  rclone copyto "$pasta/.env" "dropcrypt:${destino}env/.env" || return 1
  rclone delete "dropcrypt:${destino}data-backups" --min-age 30d
  rclone delete "dropcrypt:${destino}auth" --min-age 30d
}

echo "=== $(date '+%F %T') início ==="
copiar "$APP" "" || { echo "ERRO: nazagas (pasta do código)"; falhou=1; }
for pasta in "$CLIENTES"/*/; do
  [ -f "$pasta/.env" ] || continue
  nome=$(basename "$pasta")
  copiar "${pasta%/}" "clientes/$nome/" || { echo "ERRO: $nome"; falhou=1; }
done
[ "$falhou" -eq 0 ] && echo "=== $(date '+%F %T') fim OK ===" || { echo "=== $(date '+%F %T') fim COM ERRO ==="; exit 1; }
