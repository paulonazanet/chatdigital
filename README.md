# ChatDigital

Motor de fluxo de conversa + painel de atendimento para pequenos negócios. Produto da marca
**Eu no Digital**, com piloto em produção na **Naza Gás**.

## Arquitetura: uma instância por cliente

Cada cliente roda a sua própria cópia isolada do ChatDigital (banco de dados e configuração
próprios) — em nuvem (hospedada pela Eu no Digital) ou no servidor do próprio cliente. Não há
banco compartilhado entre clientes.

O banco de dados é **SQLite** (`data/chatdigital.db`, um arquivo só) justamente para deixar a
instalação em servidor próprio simples — não exige configurar um servidor de banco separado.

## O que já existe

- **Motor de fluxo genérico** (`src/flow-engine.js`): interpreta uma "receita" de conversa em
  `config/fluxo.json` (nós: início, mensagem, pergunta, condição, transferir, salvar, api, fim) —
  a mesma ideia de nós usada em plataformas como o Syntor. Pra atender clínica, provedor ou
  revenda em vez de gás, troca-se o `fluxo.json`, não o motor.
- **Conector de WhatsApp** (`src/bot.js`, via Baileys/WhatsApp Web — via não oficial): liga o
  motor de fluxo a um número de WhatsApp.
- **Painel web** (`src/server.js`): login, cadastro de atendentes com papéis (administrador /
  atendente) e setores, tela inicial.

## O que ainda falta (próximas etapas)

- Ligar as conversas do bot (`src/flow-engine.js`) ao banco do painel: fila de atendimento,
  histórico por cliente, e o nó "transferir" abrindo de fato uma conversa num setor.
- Atualização em tempo real da fila (WebSocket) — hoje o painel não mostra conversas ao vivo.
- Editor visual do fluxo (hoje é só o arquivo `config/fluxo.json`).
- Blocos prontos por ramo de negócio (agendamento pra clínica, catálogo pra revenda, chamado
  técnico pra provedor).

## Como rodar em desenvolvimento

```bash
npm install
cp .env.example .env
```

Preencha `.env` (pelo menos `SESSION_SECRET`, um valor aleatório qualquer) e `config/negocio.json`
com os dados reais do negócio (hoje já vem preenchido com o piloto da Naza Gás, com campos `TODO`
pendentes).

**Painel de atendimento:**

```bash
npm run painel
```

Abra `http://localhost:3000/setup` — como ainda não existe nenhum atendente cadastrado, essa tela
cria o primeiro administrador. Depois disso `/setup` redireciona sozinho para `/login`.

**Bot do WhatsApp** (piloto Naza Gás, número reserva — ver aviso abaixo):

```bash
npm start
```

Escaneia o QR Code que aparece no terminal em **Configurações > Aparelhos conectados > Conectar**
no WhatsApp do número **reserva** (não o principal de vendas — a via não oficial pode levar o
WhatsApp a bloquear o número se detectar automação).

## Testes

```bash
npm test
```

Cobre o motor de fluxo (pedido completo, FAQ, transferência para atendente, entrada inválida,
reinício) e o painel (setup do primeiro admin, login, cadastro de setores/atendentes, permissões
de admin vs. atendente comum), tudo sem precisar de WhatsApp real nem navegador.

## Estrutura

```
src/
  flow-engine.js     -> motor genérico que interpreta config/fluxo.json
  bot.js              -> conecta no WhatsApp (Baileys) e liga o motor de fluxo
  negocio.js, fluxo.js -> carregam config/negocio.json e config/fluxo.json
  registros.js         -> grava registros do fluxo (ex.: pedidos) na tabela `registros`
  db.js                -> abre/cria o banco SQLite e as tabelas
  auth.js, sessao.js    -> hash de senha e sessão via cookie assinado
  atendentes.js, setores.js -> cadastro de atendentes/setores e permissões
  server.js             -> aplicativo Express do painel
  routes/                -> rotas HTTP (auth, painel, atendentes, setores)
  views/                  -> páginas EJS do painel
config/
  negocio.json  -> dados do negócio (hoje: Naza Gás)
  fluxo.json     -> receita da conversa (hoje: fluxo da Naza Gás)
data/            -> banco SQLite (gerado em uso, gitignored)
auth/            -> sessão do WhatsApp (gerado ao escanear o QR, gitignored)
```
