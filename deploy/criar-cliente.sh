#!/usr/bin/env bash
# Cria um ChatDigital novo neste servidor (E5: um código só, uma pasta de dados por cliente).
#   sudo /opt/chatdigital/app/deploy/criar-cliente.sh <nome> <endereço>
#   ex.: sudo /opt/chatdigital/app/deploy/criar-cliente.sh novanet novanet.eunodigital.com
# Faz: pasta de dados, .env (porta livre, segredo, código do primeiro acesso), serviço
# chatdigital@<nome>, endereço com https no Caddy. Mostra o link do primeiro acesso.
# Antes: o endereço tem que apontar no DNS para este servidor (senão o https não sai).
set -euo pipefail

BASE=/opt/chatdigital
APP=$BASE/app
CLIENTES=$BASE/clientes
PORTA_INICIAL=3101 # a Nazagás de antes da E5 usa a 3001

erro() { echo "ERRO: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || erro "rode com sudo"
NOME=${1:-}
ENDERECO=${2:-}
[ -n "$NOME" ] && [ -n "$ENDERECO" ] || erro "uso: sudo $0 <nome> <endereço>   (ex.: novanet novanet.eunodigital.com)"
[[ "$NOME" =~ ^[a-z][a-z0-9-]{1,30}$ ]] || erro "nome só com letras minúsculas, números e hífen (ex.: novanet)"
[[ "$ENDERECO" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || erro "endereço inválido: $ENDERECO"
DADOS=$CLIENTES/$NOME
[ ! -e "$DADOS" ] || erro "já existe um cliente '$NOME' ($DADOS)"
grep -rqs "^$ENDERECO " /etc/caddy/clientes/ /etc/caddy/Caddyfile && erro "o endereço $ENDERECO já está em uso no Caddy"

# porta livre: a primeira a partir da inicial que nenhum cliente usa e ninguém está escutando
usadas=$(grep -hs '^PORTA=' "$CLIENTES"/*/.env | cut -d= -f2 || true)
PORTA=$PORTA_INICIAL
while echo "$usadas" | grep -qx "$PORTA" || ss -ltn | awk '{print $4}' | grep -q ":$PORTA\$"; do
  PORTA=$((PORTA + 1))
done

echo "Criando '$NOME' em $DADOS (porta $PORTA, https://$ENDERECO)"
install -d -o chatdigital -g chatdigital -m 750 "$CLIENTES" "$DADOS"
CODIGO=$(openssl rand -hex 16)
umask 077
cat > "$DADOS/.env" <<ENV
NODE_ENV=production
PORTA=$PORTA
HOST=127.0.0.1
SESSION_SECRET=$(openssl rand -hex 32)
CHATDIGITAL_DADOS=$DADOS
CHATDIGITAL_CODIGO_SETUP=$CODIGO
NUMEROS_TESTE=
ENV
chown chatdigital:chatdigital "$DADOS/.env"
chmod 600 "$DADOS/.env"

# serviço (o modelo vem do código; atualiza se mudou)
if ! cmp -s "$APP/deploy/chatdigital@.service" /etc/systemd/system/chatdigital@.service; then
  cp "$APP/deploy/chatdigital@.service" /etc/systemd/system/chatdigital@.service
  systemctl daemon-reload
fi

# https: um arquivo por cliente em /etc/caddy/clientes, importado pelo Caddyfile
install -d -m 755 /etc/caddy/clientes
grep -qs '^import /etc/caddy/clientes/\*.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/clientes/*.caddy\n' >> /etc/caddy/Caddyfile
cat > "/etc/caddy/clientes/$NOME.caddy" <<CADDY
$ENDERECO {
	reverse_proxy 127.0.0.1:$PORTA
	request_body {
		max_size 20MB
	}
}
CADDY
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  rm -f "/etc/caddy/clientes/$NOME.caddy"
  erro "o Caddy recusou a configuração (nada foi recarregado). Veja: caddy validate --config /etc/caddy/Caddyfile"
fi

systemctl enable --now "chatdigital@$NOME"
systemctl reload caddy

# espera subir (até 30 s) e confere pela página de verificação
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORTA/saude" >/dev/null 2>&1; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORTA/saude" >/dev/null 2>&1 || erro "o serviço não respondeu. Veja: journalctl -u chatdigital@$NOME -n 50 --no-pager"

echo
echo "Pronto: '$NOME' no ar na porta $PORTA."
echo "Primeiro acesso (crie o administrador; o link só serve até o 1º administrador existir):"
echo "  https://$ENDERECO/setup?codigo=$CODIGO"
echo "Se o https ainda não abrir, confira se $ENDERECO aponta para este servidor no DNS."
echo "Zabbix: monitorar https://$ENDERECO/saude procurando o texto \"whatsapp\":\"ok\"."
