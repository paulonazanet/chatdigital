# ChatDigital

Motor de fluxo de conversa + painel de atendimento para pequenos negócios. Produto da marca
**Eu no Digital**.

Este repositório é o **produto genérico**, sem dados de nenhum cliente — pronto pra ser instalado
do zero em qualquer negócio (o piloto será a Naza Gás, mas a configuração dela só entra na hora da
instalação, não faz parte deste código). `config/negocio.json` e `config/fluxo.json` aqui são só
um exemplo/modelo com campos `TODO`, pra cada instalação preencher com os dados reais do cliente.

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
  motor de fluxo a um número de WhatsApp, e registra toda mensagem (cliente e bot) no banco.
- **Painel web** (`src/server.js`): login, cadastro de atendentes com papéis (administrador /
  atendente) e setores, e a **fila de atendimento** — conversas que o nó "transferir" do fluxo
  passou pra um humano aparecem lá, com histórico completo; o atendente pode "Assumir" e
  "Finalizar".

## O que ainda falta (próximas etapas)

- **Responder pelo painel**: hoje o atendente vê o histórico na fila, mas ainda precisa responder
  pelo próprio WhatsApp — o painel (`npm run painel`) e o bot (`npm start`) rodam como processos
  separados. Unificar os dois (mesmo processo, mesma conexão do WhatsApp) é o que falta pra dar
  pra mandar mensagem direto da tela.
- Atualização em tempo real da fila (WebSocket) — hoje precisa recarregar a página.
- Editor visual do fluxo (hoje é só o arquivo `config/fluxo.json`).
- Blocos prontos por ramo de negócio (agendamento pra clínica, catálogo pra revenda, chamado
  técnico pra provedor).

## Como rodar em desenvolvimento

```bash
npm install
cp .env.example .env
```

Preencha `.env` (pelo menos `SESSION_SECRET`, um valor aleatório qualquer) e, na hora de instalar
para um cliente de verdade, `config/negocio.json` com os dados reais do negócio (os campos `TODO`
vêm em branco de propósito — é o que muda de cliente pra cliente).

**Painel de atendimento:**

```bash
npm run painel
```

Abra `http://localhost:3000/setup` — como ainda não existe nenhum atendente cadastrado, essa tela
cria o primeiro administrador. Depois disso `/setup` redireciona sozinho para `/login`.

**Bot do WhatsApp:**

```bash
npm start
```

Escaneia o QR Code que aparece no terminal em **Configurações > Aparelhos conectados > Conectar**.
Como a via é não oficial (Baileys), use sempre um número **reserva**, nunca o principal de vendas
do cliente — o WhatsApp pode bloquear um número que detecte como automatizado.

## Testes

```bash
npm test
```

Cobre o motor de fluxo (pedido completo, FAQ, transferência para atendente, entrada inválida,
reinício), o painel (setup do primeiro admin, login, cadastro de setores/atendentes, permissões
de admin vs. atendente comum) e a fila (conversa transferida aparece, histórico, assumir,
finalizar) — tudo sem precisar de WhatsApp real nem navegador.

## Estrutura

```
src/
  flow-engine.js     -> motor genérico que interpreta config/fluxo.json
  bot.js              -> conecta no WhatsApp (Baileys), liga o motor de fluxo e registra tudo no banco
  conversas.js         -> fila/histórico: camada de acesso às tabelas conversas e mensagens
  negocio.js, fluxo.js -> carregam config/negocio.json e config/fluxo.json
  registros.js         -> grava registros do fluxo (ex.: pedidos) na tabela `registros`
  db.js                -> abre/cria o banco SQLite e as tabelas
  auth.js, sessao.js    -> hash de senha e sessão via cookie assinado
  atendentes.js, setores.js -> cadastro de atendentes/setores e permissões
  server.js             -> aplicativo Express do painel
  routes/                -> rotas HTTP (auth, painel, atendentes, setores, fila)
  views/                  -> páginas EJS do painel
config/
  negocio.json  -> dados do negócio — modelo/exemplo, preencher na instalação de cada cliente
  fluxo.json     -> receita da conversa — modelo/exemplo de fluxo de pedido, genérico
data/            -> banco SQLite (gerado em uso, gitignored)
auth/            -> sessão do WhatsApp (gerado ao escanear o QR, gitignored)
```
