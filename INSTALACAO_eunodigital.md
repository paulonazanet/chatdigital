# Instalação do ChatDigital no servidor — Naza Gás (nazagas.eunodigital.com)

Guia passo a passo pra colocar o ChatDigital no ar numa máquina virtual (VM) do servidor da
Nazanet, com o endereço **https://nazagas.eunodigital.com**, pro Carlos atender os clientes da
Naza Gás.

---

## 0. Como usar este guia (leia primeiro)

**Se você (Paulo) vai seguir com ajuda de um Claude:** abra uma conversa nova, anexe este
arquivo e mande:

> "Vamos instalar o ChatDigital seguindo o INSTALACAO.md anexo. Vá UM passo de cada vez: me diga
> o comando, espere eu colar o resultado, confira se deu certo e só então passe pro próximo.
> Se algo der diferente do esperado, pare e me ajude a resolver antes de continuar. Não pule
> nenhuma verificação."

**Regras pro assistente que for ajudar:**
- Seguir a ordem das partes (A → P). Cada passo tem um **"✔ Deu certo se…"** — confirmar isso
  antes de avançar.
- Nunca pedir pro Paulo colar no chat o conteúdo do `.env` (tem a senha secreta), senhas ou
  chaves. Pra conferir, usar os comandos de verificação que não mostram o segredo.
- Não mudar código do sistema durante a instalação. Se aparecer erro no código, anotar e
  resolver depois numa sessão de desenvolvimento.
- Comandos que começam com `sudo` pedem a senha do usuário do Ubuntu (normal).
- Quando o guia mostra `<ALGUMA_COISA>`, é pra trocar pelo valor de verdade (sem os `< >`).

**Convenções deste guia:**
- `💻 No seu PC (Windows)` = rodar no PowerShell do computador do Paulo.
- `🖥️ No servidor` = rodar no terminal da VM (conectado por SSH).
- Pasta do sistema no servidor: **`/opt/chatdigital/app`**. Usuário que roda o sistema:
  **`chatdigital`** (sem senha, sem login — só pra rodar o programa).

---

## 1. O que você precisa ter em mãos antes de começar

- [ ] Domínio **eunodigital.com** na Cloudflare (conta com acesso ao painel). O endereço será o subdomínio `nazagas.eunodigital.com`.
- [ ] Um **IP público fixo** livre da Nazanet pra essa VM (ou um IP público com redirecionamento
      das portas 80 e 443 pra VM — ver Parte B).
- [ ] Acesso ao servidor IBM pra criar a VM.
- [ ] O **IP do seu escritório** (de onde você vai acessar por SSH) — pra liberar só ele.
- [ ] O **celular com o WhatsApp da Naza Gás** (pra escanear o QR Code na Parte L).
- [ ] Os arquivos de configuração do seu PC:
      `C:\Users\pjnso\Documents\claude\chatdigital\config\negocio.json` (dados reais do negócio:
      nome, produtos, preços, FAQ).
- [ ] Nome e e-mail do Carlos (pra cadastrar ele como atendente).
- [ ] (Recomendado) O outro servidor IBM acessível por SSH, pra guardar o backup (Parte N).

---

## Parte A — Domínio e DNS (Cloudflare)

> **Mudança:** não usamos mais `nazagas.com.br`. O endereço agora é um **subdomínio** do domínio
> **eunodigital.com**, que o Paulo já tem na **Cloudflare** (o DNS dele também está lá).
> Subdomínio = só criar mais um "apelido" (`nazagas`) apontando pro IP da VM. Não precisa comprar nada.
> O site eunodigital.com (Cloudflare Pages) e o e-mail contato@eunodigital.com **não são afetados**
> — só adicionamos uma entrada nova.

**A1. (Pular)** O domínio `eunodigital.com` já está registrado na Cloudflare.

**A2. Criar o subdomínio `nazagas`:**
1. Entre em https://dash.cloudflare.com e clique no domínio **eunodigital.com**.
2. No menu lateral: **DNS → Registros** (em inglês: **DNS → Records**).
3. Clique em **Adicionar registro** (**Add record**) e preencha:
   - Tipo: **A**
   - Nome: **nazagas** (vira `nazagas.eunodigital.com`)
   - Endereço IPv4: **`<IP_PUBLICO_DA_VM>`**
   - Status do proxy: **somente DNS** (nuvem **CINZA**, "DNS only"). ⚠️ **Importante:** a nuvem
     laranja (Proxied) atrapalha a emissão do certificado HTTPS pelo Caddy e o QR Code/WebSocket do
     WhatsApp. Se estiver laranja, clique nela até ficar cinza.
   - TTL: **Auto**
4. **Salvar**.
5. **Não mexa** nos outros registros existentes (os CNAME do site, os MX/SPF/DKIM do e-mail).

**A3. Conferir** (na Cloudflare costuma valer em poucos minutos):

💻 No seu PC (Windows):
```powershell
nslookup nazagas.eunodigital.com 8.8.8.8
```
✔ Deu certo se aparecer `Address: <IP_PUBLICO_DA_VM>`. Se ainda não aparecer, siga com as
próximas partes e confira de novo antes da Parte I.

---

## Parte B — Criar a máquina virtual (VM)

**B1. Recursos da VM:**
- Sistema: **Ubuntu Server 24.04 LTS** (64 bits).
- **2 vCPU**, **2 GB de memória**, **20 GB de disco** (sobra pra Naza Gás e pros testes de
  outros clientes depois).

**B2. Rede (importante pra segurança da Nazanet):**
- Coloque a VM numa **VLAN separada (DMZ)**, que **não** enxergue a rede de gerência dos
  equipamentos da Nazanet (OLTs, MikroTik, Zabbix, etc.). Se um dia alguém invadir o chat, não
  chega no resto da rede.
- Dê à VM o **IP público fixo** direto, **ou** deixe ela com IP interno e faça o
  redirecionamento (NAT) só das portas **80** e **443** do IP público pra ela, e da porta **22**
  (SSH) só a partir do IP do seu escritório.

**B3. Instalação do Ubuntu** (nas telas do instalador):
- Idioma: pode ser English ou Português (os comandos são os mesmos).
- Rede: configure o IP fixo, máscara, gateway e DNS (ex.: 8.8.8.8 e 1.1.1.1).
- Disco: usar o disco inteiro (padrão).
- Nome do servidor: `chat-nazagas`.
- Usuário: crie o seu usuário administrador (ex.: `paulo`) com uma **senha forte**.
- Marque **"Install OpenSSH server"**.
- Não precisa marcar nenhum "snap" extra.
- No fim, reiniciar.

**B4. Conectar por SSH:**

💻 No seu PC (Windows):
```powershell
ssh <SEU_USUARIO>@<IP_DA_VM>
```
✔ Deu certo se aparecer o prompt do Ubuntu, algo como `paulo@chat-nazagas:~$`.

---

## Parte C — Preparar o Ubuntu

🖥️ No servidor, um bloco de cada vez:

**C1. Atualizar tudo:**
```bash
sudo apt update && sudo apt upgrade -y
```
✔ Termina sem mensagens de "E:" (erro). Se pedir pra reiniciar serviços, aceite o padrão.

**C2. Fuso horário (IMPORTANTE — o bloco "Horário" do fluxo usa a hora do servidor):**
```bash
sudo timedatectl set-timezone America/Recife
timedatectl
```
✔ Deu certo se aparecer `Time zone: America/Recife (-03, -0300)` e a hora local certa.

**C3. Atualizações automáticas de segurança:**
```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```
✔ Termina sem erro.

**C4. Firewall** (troque `<IP_DO_ESCRITORIO>` pelo IP público de onde você acessa):
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <IP_DO_ESCRITORIO> to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```
⚠️ Confira o IP do escritório ANTES do `ufw enable` — se errar, você perde o acesso SSH e vai
precisar entrar pelo console da VM no servidor IBM pra corrigir.
✔ Deu certo se o `status` mostrar 22 liberado só pro seu IP e 80/443 pra qualquer um
(`Anywhere`).

**C5. Proteção contra tentativa de senha no SSH (opcional, recomendado):**
```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

---

## Parte D — Instalar Node.js, ffmpeg e git

**D1. Node.js 24** (o sistema precisa do Node 22 ou mais novo; usamos o 24, o mesmo do PC do
Paulo):
```bash
sudo apt install -y curl ca-certificates git build-essential
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```
✔ Deu certo se `node -v` mostrar `v24.` alguma coisa.

**D2. ffmpeg** (sem ele, os áudios gravados no painel não chegam direito no WhatsApp):
```bash
sudo apt install -y ffmpeg
ffmpeg -version | head -1
```
✔ Deu certo se mostrar `ffmpeg version ...`.

---

## Parte E — Baixar o sistema

**E1. Criar o usuário que roda o sistema e a pasta:**
```bash
sudo useradd --system --create-home --home-dir /opt/chatdigital --shell /usr/sbin/nologin chatdigital
sudo chmod 755 /opt/chatdigital
ls -ld /opt/chatdigital
```
✔ Deu certo se a pasta `/opt/chatdigital` existir com dono `chatdigital` e começar com
`drwxr-xr-x` (o seu usuário precisa conseguir entrar nela pra rodar os próximos comandos; o
`.env` com o segredo continua protegido só pro `chatdigital`, ver F2).

**E2. Baixar o código do GitHub:**

- **Se o repositório estiver PÚBLICO** (é como está hoje, 30/09/2026):
  ```bash
  sudo -u chatdigital git clone https://github.com/paulonazanet/chatdigital.git /opt/chatdigital/app
  ```
- **Se o repositório estiver PRIVADO** (recomendado — ver observação no fim do guia), use uma
  "deploy key" só de leitura:
  ```bash
  sudo -u chatdigital mkdir -p /opt/chatdigital/.ssh
  sudo -u chatdigital ssh-keygen -t ed25519 -N "" -f /opt/chatdigital/.ssh/id_ed25519 -C "chat-nazagas"
  sudo cat /opt/chatdigital/.ssh/id_ed25519.pub
  ```
  Copie a linha que apareceu (começa com `ssh-ed25519`) e cadastre no GitHub:
  repositório `paulonazanet/chatdigital` → **Settings → Deploy keys → Add deploy key** → cole,
  deixe **"Allow write access" DESMARCADO** → Add key. Depois:
  ```bash
  sudo -u chatdigital ssh -o StrictHostKeyChecking=accept-new -T git@github.com
  sudo -u chatdigital git clone git@github.com:paulonazanet/chatdigital.git /opt/chatdigital/app
  ```
  (a primeira linha deve responder algo como "successfully authenticated… does not provide
  shell access" — isso é o esperado.)

✔ Deu certo se `ls /opt/chatdigital/app` mostrar `package.json`, `src`, `config`, `public`…

**E3. Instalar as dependências:**
```bash
cd /opt/chatdigital/app
sudo -u chatdigital npm ci --omit=dev
```
✔ Termina com algo como `added NNN packages`. Avisos (`npm warn`) são normais; `npm error`
não é — nesse caso, pare e resolva.

**E4. Proteger os arquivos de configuração de atualizações futuras** (o `git pull` não vai
sobrescrever o que for configurado no servidor):
```bash
cd /opt/chatdigital/app
sudo -u chatdigital git update-index --skip-worktree config/negocio.json config/fluxo.json
```

---

## Parte F — Configuração

**F1. Copiar os dados reais do negócio** (produtos, preços, FAQ — hoje só dá pra editar
produtos/FAQ por esse arquivo):

💻 No seu PC (Windows):
```powershell
scp "C:\Users\pjnso\Documents\claude\chatdigital\config\negocio.json" <SEU_USUARIO>@<IP_DA_VM>:/tmp/negocio.json
```
🖥️ No servidor:
```bash
sudo mv /tmp/negocio.json /opt/chatdigital/app/config/negocio.json
sudo chown chatdigital:chatdigital /opt/chatdigital/app/config/negocio.json
sudo -u chatdigital node -e "JSON.parse(require('fs').readFileSync('/opt/chatdigital/app/config/negocio.json','utf8')); console.log('negocio.json OK')"
```
✔ Deu certo se aparecer `negocio.json OK`.

> O fluxo do bot (`config/fluxo.json`) já vem do GitHub. Depois dá pra ajustar pelo menu
> **Fluxo** do painel.

**F2. Criar o `.env` de produção:**
```bash
cd /opt/chatdigital/app
SEGREDO=$(openssl rand -hex 32)
sudo -u chatdigital tee .env > /dev/null <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORTA=3001
SESSION_SECRET=$SEGREDO
NUMERO_ATENDENTE=
NUMEROS_TESTE=
EOF
unset SEGREDO
sudo chmod 600 .env
sudo ls -l .env
sudo grep -c "SESSION_SECRET=." .env
```
✔ Deu certo se o `ls` mostrar `-rw-------` com dono `chatdigital`, e o `grep -c` mostrar `1`.
(Não precisa ver o valor do segredo — nem cole ele em lugar nenhum.)

O que cada linha faz:
- `NODE_ENV=production` — liga as proteções de produção (o sistema não sobe sem um
  `SESSION_SECRET` forte; o cookie de login só trafega por HTTPS).
- `HOST=127.0.0.1` + `PORTA=3001` — o sistema só escuta dentro da própria máquina; quem fala com
  a internet é o Caddy (Parte I).
- `NUMERO_ATENDENTE=` — opcional: um número pra "chamar direto" que o bot mostra ao transferir
  (ex.: `(81) 9 9999-9999`). Vazio, a linha não aparece pro cliente.
- `NUMEROS_TESTE=` — **ver Parte M**. Vazio = o bot atende TODOS os clientes.

**F3. Teste rápido na mão:**
```bash
cd /opt/chatdigital/app
sudo -u chatdigital node src/app.js
```
✔ Deu certo se aparecer `Painel do ChatDigital em http://127.0.0.1:3001` (vai aparecer também
um QR Code no terminal — ignore por enquanto). Aperte **Ctrl+C** pra parar.
❌ Se aparecer `ERRO: SESSION_SECRET ausente ou fraco`, o `.env` não foi criado direito — refaça a F2.

---

## Parte G — Deixar o sistema ligando sozinho (serviço do sistema)

**G1. Criar o serviço:**
```bash
sudo tee /etc/systemd/system/chatdigital.service > /dev/null <<'EOF'
[Unit]
Description=ChatDigital (painel + bot WhatsApp)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=chatdigital
Group=chatdigital
WorkingDirectory=/opt/chatdigital/app
ExecStart=/usr/bin/node src/app.js
Restart=always
RestartSec=5
# endurecimento básico
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now chatdigital
sudo systemctl status chatdigital --no-pager
```
✔ Deu certo se aparecer `Active: active (running)`.

**G2. Ver o log** (útil sempre que algo estranho acontecer):
```bash
sudo journalctl -u chatdigital -n 50 --no-pager
```
✔ Deve mostrar `Painel do ChatDigital em http://127.0.0.1:3001`.
(Pra acompanhar ao vivo: `sudo journalctl -u chatdigital -f` — sai com Ctrl+C.)

**G3. Conferir que responde dentro da máquina:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/login
```
✔ Deu certo se mostrar `200`.

---

## Parte H — (reservada) conferir o DNS antes do HTTPS

💻 No seu PC, repita o `nslookup nazagas.eunodigital.com 8.8.8.8` da Parte A3.
✔ Só siga pra Parte I quando o IP aparecer certo — o certificado HTTPS depende disso.

---

## Parte I — HTTPS com o Caddy

**I1. Instalar o Caddy** (servidor web que tira o certificado HTTPS sozinho e renova sozinho):
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
caddy version
```
✔ Deu certo se `caddy version` mostrar `v2.` alguma coisa.

**I2. Configurar o endereço:**
```bash
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
nazagas.eunodigital.com {
	reverse_proxy 127.0.0.1:3001
	request_body {
		max_size 20MB
	}
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```
✔ Deu certo se o `validate` disser `Valid configuration` e o status `active (running)`.

**I3. Testar de fora:** abra no navegador **https://nazagas.eunodigital.com**
✔ Deu certo se abrir a tela do ChatDigital com o **cadeado** do HTTPS.
❌ Se não abrir: `sudo journalctl -u caddy -n 50 --no-pager` — erro de certificado quase sempre
é DNS ainda não apontando pro IP (Parte A) ou porta 80/443 bloqueada (Parte C4 / NAT da Parte B2).

---

## Parte J — Primeiro acesso (faça LOGO depois da Parte I)

⚠️ Enquanto ninguém criou o primeiro administrador, qualquer pessoa que abrir o endereço
consegue criar. Por isso faça isto **imediatamente** depois que o HTTPS funcionar.

1. Abra **https://nazagas.eunodigital.com/setup**
2. Crie o administrador: seu nome, seu e-mail e uma **senha forte**.
3. Depois de entrar, vá em **Atendentes → Novo atendente** e crie **um segundo administrador**
   de reserva (outro e-mail seu, senha forte guardada num lugar seguro). O painel não tem
   "esqueci minha senha": se você perder a senha do único admin, fica difícil de recuperar.
✔ Deu certo se, abrindo `/setup` de novo, ele mandar pro login (ou seja, não deixa criar outro).

---

## Parte K — Configurar a Naza Gás no painel

1. **Configurações** — conferir nome, horário, endereço, formas de pagamento; as mensagens
   automáticas; os tempos da fila (bolinha), da inatividade e do fechamento automático. Salvar.
2. **Setores** — conferir/criar os setores (o "Geral" já existe).
3. **Fluxo** — revisar o menu do bot: textos, produtos, preços, horário de funcionamento. Salvar.
4. **Atendentes → Novo atendente** — cadastrar o **Carlos**:
   - Papel: **atendente**.
   - Setores: os que ele atende.
   - Permissões: no mínimo **Responder conversas** e **Finalizar conversas**. Se ele for olhar
     todos os setores, marque também **Ver fila de outros setores**.
   - Passe o e-mail e a senha pra ele pessoalmente (não por mensagem).

---

## Parte L — Conectar o WhatsApp da Naza Gás

1. No painel: **Configurações → WhatsApp**. Vai aparecer o QR Code.
2. No celular da Naza Gás: WhatsApp → **Configurações (ou os três pontinhos) → Aparelhos
   conectados → Conectar um aparelho** → aponte pro QR Code na tela.
3. ✔ Deu certo se a tela mudar pra **conectado** e o log mostrar
   `Bot da ... conectado e pronto para atender`:
   ```bash
   sudo journalctl -u chatdigital -n 20 --no-pager
   ```

Sobre o celular:
- Ele continua funcionando normal (o sistema vira um "aparelho conectado", como o WhatsApp Web).
- **Não desconecte** o aparelho "ChatDigital" em "Aparelhos conectados".
- O celular precisa entrar na internet de vez em quando (pelo menos a cada ~14 dias), senão o
  WhatsApp desconecta os aparelhos vinculados.

---

## Parte M — Teste controlado antes de liberar pra todos os clientes

**Recomendado:** nos primeiros dias, deixar o bot respondendo só alguns números conhecidos.

1. Edite o `.env`:
   ```bash
   sudo -u chatdigital nano /opt/chatdigital/app/.env
   ```
   Na linha `NUMEROS_TESTE=` coloque os números de teste com 55 + DDD, separados por vírgula,
   sem espaço (ex.: `NUMEROS_TESTE=5581999990000,5581988880000`). Salve com **Ctrl+O**, Enter,
   e saia com **Ctrl+X**.
2. Reinicie: `sudo systemctl restart chatdigital`
3. Teste de um desses números: mande "oi", navegue no menu, peça atendente, veja chegar na Fila,
   o Carlos assume, responde, manda foto/áudio, finaliza, responde a pesquisa.
4. Com o modo de teste ligado, clientes de verdade continuam falando no celular normalmente —
   o bot só não responde eles, e as mensagens automáticas não vão pra eles.

**Pra liberar pra todos:** apague os números da linha (fica `NUMEROS_TESTE=`) e
`sudo systemctl restart chatdigital`.

> **O que aprendemos nos testes (02/10/2026):**
> - O bot responde **uma vez por atendimento**. Se o fluxo transfere pro atendente (ex.: boas-vindas →
>   atendente), depois da primeira resposta ele fica mudo com aquele número até o atendente
>   **finalizar a conversa** no painel. Isso é o esperado, não é defeito.
> - Ao testar do seu próprio número, peça ao Carlos (ou finalize você mesmo) a conversa antes de cada novo teste.
> - Conversas só com o bot não aparecem na Fila; só aparecem quando vão pra atendente.
> - Editar o fluxo pelo painel vale na hora, sem reiniciar (versão `133f72c` ou mais nova). Se editar o
>   arquivo `fluxo.json` direto no servidor, reinicie: `sudo systemctl restart chatdigital`.
> - Se o WhatsApp parar de receber, veja o log: `sudo journalctl -u chatdigital -n 40 --no-pager`.

---

## Parte N — Backup fora da VM (Dropbox, criptografado)

O sistema já faz um backup do banco por dia em `/opt/chatdigital/app/data/backups/` (guarda 30
dias), mas fica no mesmo disco. Copiamos pro **Dropbox da conta do negócio**
(`nazagascomercio@gmail.com`, 2 GB grátis), **criptografado** com o rclone — o Dropbox guarda só
arquivos ilegíveis. O backup inclui o `.env` e a sessão do WhatsApp, por isso a criptografia.

> **Regra:** o código (token) que o `rclone authorize` mostra no PC e as senhas da criptografia
> **nunca** vão pra conversa/chat. Só pro terminal da VM (botão direito do mouse pra colar).

**N1. Instalar o rclone na VM e no PC:**
```bash
sudo apt install -y rclone
```
💻 No PC (Windows): `winget install Rclone.Rclone` (feche e abra o PowerShell).

**N2. Conectar o Dropbox** (a autorização é no PC, o código volta pra VM):
1. 🖥️ Na VM: `sudo rclone config` → **n** → nome **dropbox** → Storage **dropbox** → Enter, Enter →
   advanced **n** → "web browser" **n**. Fica parado em `config_token>` (não digite nada).
2. 💻 No PC: `rclone authorize "dropbox"` → autorize na conta **do negócio** → copie **só a linha do
   meio** (a que começa com `{`).
3. 🖥️ Cole na VM em `config_token>` (botão direito) → Enter → `Keep this remote?` **y** → **q**.
   ✔ Confira: `sudo rclone about dropbox:` mostra ~2 GiB.
   (Se colou o código por engano em algum chat: revogue em Dropbox → Configurações → Segurança →
   Aplicativos conectados → rclone → Desconectar, e refaça.)

**N3. Criar a criptografia:** `sudo rclone config` → **n** → nome **dropcrypt** → Storage **crypt** →
remote `dropbox:chatdigital-backup` → Enter, Enter → senha **g** (256) → **y** → salt **g** (256) →
**y** → advanced **n** → **y** → **q**.
⚠️ **Anote a senha e o salt fora da VM** (cofre de senhas/papel). Sem eles o backup não abre.
(Se esquecer de anotar: `sudo rclone config show dropcrypt` e `sudo rclone reveal <valor>`.)

**N4. Testar a cópia na mão.** (A pasta `auth` tem ~4.500 arquivos pequenos: copiar um por um pro
Dropbox leva mais de uma hora, por isso o script do N5 **compacta a `auth` num `.tgz`** antes de enviar.)
```bash
sudo rclone copy /opt/chatdigital/app/data/backups dropcrypt:data-backups -v
sudo rclone copy /opt/chatdigital/app/config dropcrypt:config -v
sudo rclone copyto /opt/chatdigital/app/.env dropcrypt:env/.env -v
```
✔ Conferir a criptografia: `sudo rclone ls dropcrypt:` (nomes normais) e
`sudo rclone ls dropbox:chatdigital-backup` (nomes embaralhados).

**N5. Agendar todo dia às 3h:** ver o script `/usr/local/bin/backup-chat.sh` e o `cron` abaixo.

```bash
sudo tee /usr/local/bin/backup-chat.sh >/dev/null <<'EOS'
#!/bin/bash
set -u
APP=/opt/chatdigital/app
TMP=$(mktemp /var/tmp/auth-XXXXXX.tgz)
trap 'rm -f "$TMP"' EXIT
echo "=== $(date '+%F %T') início ==="
rclone copy "$APP/data/backups" dropcrypt:data-backups || exit 1
rclone copy "$APP/config" dropcrypt:config || exit 1
tar czf "$TMP" -C "$APP" auth || exit 1
rclone copyto "$TMP" "dropcrypt:auth/auth-$(date +%F).tgz" || exit 1
rclone copyto "$APP/.env" dropcrypt:env/.env || exit 1
rclone delete dropcrypt:data-backups --min-age 30d
rclone delete dropcrypt:auth --min-age 30d
echo "=== $(date '+%F %T') fim OK ==="
EOS
sudo chmod 700 /usr/local/bin/backup-chat.sh
sudo crontab -e
```
No fim do crontab (escolha `nano`), acrescente:
```
0 3 * * * /usr/local/bin/backup-chat.sh >> /var/log/backup-chat.log 2>&1
```
✔ No dia seguinte: `sudo tail -5 /var/log/backup-chat.log` deve terminar com `fim OK`.

**Restaurar (se a VM morrer):** instale o rclone na VM nova, recrie os remotes `dropbox` e `dropcrypt`
**com a mesma senha e o mesmo salt anotados**, e copie de volta: `rclone copy dropcrypt:config
/opt/chatdigital/app/config` (idem `data-backups` e `env/.env`). Para a sessão do WhatsApp: baixe o
`auth-DATA.tgz` mais recente (`rclone copy dropcrypt:auth /tmp/auth-bk`) e extraia com
`sudo tar xzf /tmp/auth-bk/auth-DATA.tgz -C /opt/chatdigital/app`.

---

## Parte O — Monitorar no Zabbix

Feito em 02/10/2026 pelo painel do Zabbix da Nazanet (detalhes em `Nazanet\zabbix\zabbix.md`):
- Grupo de hosts **CHATDIGITAL** e host **CHATDIGITAL NAZA GAS** (sem agente/interface).
- **Cenário web** "Login ChatDigital": URL `https://nazagas.eunodigital.com/login`, código **200**,
  intervalo 1 min.
- **Trigger** "ChatDigital fora do ar", severidade Alta: `min(/CHATDIGITAL NAZA GAS/web.test.fail[Login ChatDigital],#3)>0` (3 falhas seguidas).
- **Action GERAL**: condição extra "Grupo de hosts igual CHATDIGITAL" → aviso no Telegram
  "Nazanet Alertas". Sem som na tela do NOC (decisão do Paulo).
- ⚠️ Use o endereço **exato**: se a URL do cenário apontar pra um nome que não existe no DNS, o
  Zabbix mostra "Could not resolve host" e a trigger dispara.

---

## Parte P — Atualizar o sistema depois (quando sair versão nova)

```bash
cd /opt/chatdigital/app
sudo -u chatdigital cp data/chatdigital.db data/antes-da-atualizacao.db
sudo -u chatdigital git pull
sudo -u chatdigital npm ci --omit=dev
sudo systemctl restart chatdigital
sudo journalctl -u chatdigital -n 30 --no-pager
```
✔ Deu certo se o log mostrar o painel e o bot conectados de novo.
Se o `git pull` reclamar de `config/negocio.json` ou `config/fluxo.json`, é porque a versão nova
mexeu no modelo desses arquivos — pare e resolva numa sessão de desenvolvimento (não apague a
configuração do servidor).

---

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Site não abre | `nslookup` (Parte A3); `sudo ufw status`; `sudo systemctl status caddy`; `sudo journalctl -u caddy -n 50` |
| "502 Bad Gateway" | O sistema caiu: `sudo systemctl status chatdigital` e `sudo journalctl -u chatdigital -n 100` |
| Não consegue logar (volta pro login) | Tem que ser por **https://** (em produção o login só funciona com HTTPS) |
| Mensagem do cliente não chega / "Bad MAC" / "No matching sessions" no log | Sessão do WhatsApp corrompida: `sudo systemctl stop chatdigital`, `sudo -u chatdigital mv /opt/chatdigital/app/auth /opt/chatdigital/app/auth-velho`, `sudo systemctl start chatdigital` e escanear o QR de novo (Parte L) |
| Bot não responde ninguém | Conferir `NUMEROS_TESTE` no `.env` (Parte M) e se o WhatsApp está conectado (Configurações → WhatsApp) |
| Áudio gravado no painel não chega | `ffmpeg -version` (Parte D2) |
| Bloco "Horário" do fluxo erra a hora | `timedatectl` (Parte C2) |
| Sistema não sobe e o log diz `SESSION_SECRET ausente ou fraco` | Refazer a Parte F2 |

---

## Checklist final

- [x] https://nazagas.eunodigital.com abre com cadeado
- [x] Administrador + administrador reserva criados; `/setup` não deixa criar outro
- [x] Configurações, Setores e Fluxo revisados
- [x] Carlos cadastrado e conseguiu entrar
- [x] WhatsApp da Naza Gás conectado
- [x] Teste completo feito com `NUMEROS_TESTE` (Parte M)
- [x] `NUMEROS_TESTE` esvaziado pra atender todos (liberado)
- [x] Backup diário indo pro Dropbox criptografado (Parte N) — conferir o 1º automático em 03/10
- [x] Zabbix monitorando (Parte O)
- [x] Card "Instalar e testar ChatDigital na Naza Gás" atualizado no Trello

---

### Observação: repositório público
Em 30/09/2026 o repositório `paulonazanet/chatdigital` estava **público** no GitHub (qualquer
pessoa pode ver e copiar o código). Como é um produto pra vender, o recomendado é torná-lo
**privado** (GitHub → Settings → General → Danger Zone → Change visibility). Se fizer isso antes
da instalação, use a opção "PRIVADO" da Parte E2.
