# ChatDigital — resumo pra continuar numa conversa nova

> Leia este arquivo inteiro antes de mexer em qualquer coisa. O que cada tela faz (pra usar e
> pra montar o wiki) está em `FUNCIONALIDADES.md`.

## Regra de trabalho
**Sempre que terminar uma funcionalidade nova (ou mudar o jeito de uma existente), anotar em
`FUNCIONALIDADES.md`**, no menu certo, em linguagem de usuário — é a base do wiki menu por menu.
O histórico técnico (commits, decisões, bugs) continua aqui no `RESUMO_SESSAO.md`.

## O que é o projeto
Painel de atendimento via WhatsApp pro Paulo (Naza Gás — gás/água). Stack: Node.js + Express +
EJS + SQLite (`node:sqlite`) + Baileys (`@whiskeysockets/baileys` 7.0.0-rc14) pra conectar no
WhatsApp. Repositório: `paulonazanet/chatdigital` no GitHub, branch `main`. Projeto local em
`C:\Users\pjnso\Documents\claude\chatdigital`.

Roda localmente na porta **3001** (nunca mexer em processo na porta 3000, pode ser outra coisa
do Paulo). Comando: `npm start` (roda `node src/app.js`). Painel em http://localhost:3001.

Testes: `npm test` (usa `node:test`). ~8 arquivos "falham" só por causa de um `EPERM` do Windows
ao apagar a pasta temporária no `after()` (o banco SQLite ainda está aberto) — não é bug de
código; todas as asserções passam antes disso. Dá pra limpar fechando o banco antes do `rmSync`,
mas o Paulo ainda não pediu.

## Modo de teste (importante!)
O `.env` (não commitado) tem `NUMEROS_TESTE` com os dois números de teste do Paulo (ver o
`.env`, não copiar os números pra cá). Regra em `src/modo-teste.js`, vale nos dois sentidos:
- **chegando**: o bot só responde pra esses números;
- **saindo**: mensagem que o sistema manda sozinho (lembrete de inatividade, transferência por
  inatividade, fechamento automático, aviso de avaliação vencida) só vai pra eles — quem está fora
  da lista é tratado do mesmo jeito, só que em silêncio.
Ações manuais do atendente no painel não passam por esse filtro. Em produção (sem a variável)
vale pra todo mundo.

## Como está hoje (30/09/2026; produção desde 02/10, ver a seção abaixo)
Tudo abaixo está commitado e no GitHub. Os cards de alteração do ChatDigital no Trello (board
**Nazagas**) estão todos em FEITO. Continuam em "A FAZER":
- **Instalar e testar na Naza Gás com o Carlos atendendo** (prazo era 29/09 — atrasado);
- **Estratégia de módulos/planos** (decisão de produto, sessão de planejamento).

## O que foi feito em 29–30/09/2026 (em ordem, com o commit)
**Correções**
1. `4f583ee` — **Baileys 6.7 → 7.0.0-rc14** (a 6.7 tinha vulnerabilidade e bugs de sessão com
   `@lid`; NUNCA usar a `6.17.16`, tem CVE de spoofing). Trocar versão grande = apagar `auth/` e
   escanear o QR de novo. Junto: `msg.key.senderPn` virou `msg.key.remoteJidAlt` na v7 (sem isso
   o modo de teste descartava a mensagem em silêncio), e "+ Nova conversa" resolve o `@lid` via
   `sock.signalRepository.lidMapping.getLIDForPN` (senão a resposta caía numa conversa fantasma).
2. `f9e3923` — **Restaura no boot quem estava com atendente** (`restaurarAtendimentosEmAndamento`
   em `src/conversas.js`, chamada em `src/app.js`). O estado "humano" vive só na memória do
   motor de fluxo e zerava a cada reinício.
3. `ff665c8` — Atendimento novo (`transferirParaHumano`) **cancela a pesquisa de satisfação
   pendente** (senão a 1ª resposta virava "obrigado pela avaliação").
4. `d8824d0` — **Pop-up duplicado**: cada aba do painel tocava bipe + notificação do Windows.
   Evento SSE ganhou `id` único; o navegador usa `navigator.locks` + `tag` pra avisar 1 vez.
5. `a150646` — **"oi"/"olá"/"menu" não religam o bot durante atendimento humano** (decisão do
   Paulo: com atendente, o bot só volta ao finalizar). Antes, "oi" reabria o menu e tirava a
   conversa da fila.
6. `4312eea` — Linha de mensagem do fluxo cuja **variável está vazia sai inteira** (ia
   "Se preferir já chamar direto: ." pro cliente). `substituirTextoDeMensagem` em `flow-engine.js`.
7. `40b1f3b` — Painel de emoji fecha ao escolher; "×" do anexo respeita `hidden`; balão do
   histórico mantém quebras de linha e mostra `*negrito*`/`_itálico_`/`~riscado~` (escapando HTML).

**Funcionalidades**
8. `7ca550b` — **Nome do atendente no histórico** (coluna `mensagens.atendente_id`).
9. `45840b1` — Número fixo no topo da conversa, **ícones novos** (Tabler, botão azul-marinho —
   "opção C" aprovada) no lugar de 🙂📎🎤, **balão do atendente verde-escuro** (`#0f6e56`).
10. `59ab731` — **Fila nova ("opção A ajustada")**: lista única com filtros, "há X min", bolinha
    amarela/vermelha pelo tempo de espera (minutos em Configurações), "No bot" com botão Puxar,
    ações no topo da conversa, conversa com tamanho fixo, faixa do topo alinhada (72px).
11. `eb4efe0` — **Busca por número/nome** (instantânea, sem acento, com/sem nono dígito), filtro
    **Finalizadas** (últimas 50; a busca procura em todas), setor como botão com ícone ("opção 1"),
    **nome do cliente** (pushName do WhatsApp + lápis pra trocar; editado não é sobrescrito).
12. `2005bf7` — **Inatividade configurável** (lembrete/desistir/reiniciar ou transferir pra um
    setor), **fechamento automático** (padrão 24h desde a abertura, 0 desliga; coluna
    `conversas.aberta_em`) e **modo de teste nas mensagens automáticas** (`src/modo-teste.js`).

13. (30/09) **Segurança pra produção**: com `NODE_ENV=production` o sistema não sobe sem um
    `SESSION_SECRET` forte (≥ 32 caracteres, não o de exemplo), o cookie de login vira `secure`
    (só HTTPS) com `trust proxy` pro Caddy local, e `HOST=127.0.0.1` faz ele escutar só dentro
    da máquina. Guia completo de instalação em **`INSTALACAO.md`** (VM Ubuntu no servidor da
    Nazanet, `chat.nazagas.com.br`, Caddy + serviço systemd, backup pro outro servidor, Zabbix).

⚠️ O repositório `paulonazanet/chatdigital` no GitHub está **público** (30/09). Recomendado
torná-lo privado (é produto pra vender); o histórico antigo tem os telefones de teste no
`RESUMO_SESSAO.md` do commit `d8824d0`.

Em 30/09 também: as 7 conversas simuladas (`5581900000…`) foram finalizadas em silêncio direto
no banco (cópia antes em `data/copias/`), pra o fechamento automático não mandar mensagem pra
números que podem ser de gente real.

## O que foi feito em 02/10/2026 (instalação em produção e correções)

**Em produção:** VM Ubuntu da Nazanet, endereço **https://nazagas.eunodigital.com** (domínio
`eunodigital.com` na Cloudflare, registro A `nazagas`, DNS "somente DNS"; **não** é `.com.br`, que é
de terceiros). Guia seguido: `INSTALACAO_eunodigital.md` (cópia do `INSTALACAO.md` original, que era
do domínio antigo nazagas.com.br). Carlos entrou, o WhatsApp da Naza Gás foi conectado e ele atendeu
3 clientes reais: teste completo OK. Fluxo atual no servidor: boas-vindas → transferir pro atendente.

Commits do dia (todos em `main`):
- `10542f5` — o bot relê o `config/fluxo.json` a cada lote de mensagens (antes só lia no boot, e o
  editor do painel só gravava o arquivo: edição só valia depois de reiniciar o serviço).
- `133f72c` — `sincronizarConversa` ganhou `{ vinhaDoBot }`: se a conversa estava `finalizado` e o
  motor transfere pra humano na mesma volta (fluxo boas-vindas → atendente), ela volta pra
  `aguardando`. Antes ficava `finalizado`: fora da Fila e o bot mudo pra esse cliente.
- `daa1871` / `d90fcbf` — log temporário `[diag]` colocado e removido.

Lições:
- O bot responde **uma vez por atendimento**: depois da transferência ele fica mudo até o atendente
  finalizar (esperado). Ao testar do próprio número, finalize a conversa antes de cada teste.
- Conversa só com o bot não aparece na Fila (só `aguardando`/`atendendo`).
- Na VM a pasta é do usuário `chatdigital`: `git` precisa de `sudo -u chatdigital git ...`.
- Pasta `auth` (sessão do WhatsApp) tem ~4.500 arquivos: no backup vai compactada (`.tgz`).

Infra criada fora do código:
- **Backup:** `/usr/local/bin/backup-chat.sh` + `cron` às 3h (log `/var/log/backup-chat.log`); `rclone`
  com remote `dropcrypt` (criptografado) sobre o Dropbox da conta nazagascomercio@gmail.com, pasta
  `chatdigital-backup`; guarda 30 dias. A senha e o salt da criptografia estão anotados pelo Paulo
  fora da VM. Detalhes e restauração: Parte N do `INSTALACAO_eunodigital.md`.
- **Zabbix:** host `CHATDIGITAL NAZA GAS`, cenário web 200 em `/login` a cada 1 min, trigger Alta
  (3 falhas), aviso só no Telegram "Nazanet Alertas" (Action GERAL). Detalhes em
  `Nazanet\zabbix\zabbix.md`.
- **Trello** (board Nazagas): card da instalação em FEITO; cards de lembrete: conferir o backup
  (03/10) e revisar erros com o Carlos (10/10).

Pendências: conferir o backup automático em 03/10; revisar com o Carlos em ~10/10; só depois novas
funcionalidades. Repositório público no GitHub (decidir tornar privado: o `git pull` na VM passaria a
precisar de chave de acesso).

## Decisões do Paulo (não mudar sem perguntar)
- Botão "+ Nova conversa" continua azul-marinho (laranja foi descartado).
- `aguardandoAvaliacao` (esperando a nota da pesquisa) fica só em memória — reiniciar nos 30 min
  após finalizar pode fazer a nota abrir o menu; aceitável.
- Com atendente, nenhuma palavra ("oi", "menu"...) religa o bot; só finalizar.
- Fechamento automático conta desde a **abertura** do atendimento, não da última mensagem.
- Fila abre no filtro "Minhas" e lembra o último filtro/setor (cookie `filtroFila`).
- Bolinha só aparece quando é a vez do atendente; amarela 0 min / vermelha 10 min (editável).
- Cliente pode ter o nome trocado quantas vezes quiser; em branco volta pro nome do perfil.

## Arquitetura rápida (pontos que mais confundem)
- **`@lid` vs `@s.whatsapp.net`**: o WhatsApp às vezes identifica o mesmo contato por um ID
  interno (`@lid`). Bot e painel precisam usar o mesmo JID pra mesma pessoa, senão vira conversa
  fantasma. `numero_exibicao` guarda o telefone legível só pra mostrar/buscar.
- **Nono dígito**: o WhatsApp às vezes guarda o celular sem o 9 (`558196850663`). Comparações e
  busca tratam com e sem ele (`formaCurtaNumeroBr` em `modo-teste.js`, `variantesDoNumeroBuscado`
  em `conversas.js`, e o mesmo em `public/js/fila-lista.js`).
- **Estado em memória (`flow-engine.js`) vs banco (`conversas.js`)**: dois lugares guardam "onde
  a conversa está". O banco sobrevive a reinício, a memória não — já causou vários bugs. O boot
  restaura quem estava com atendente.
- **Linha de `conversas` é reaproveitada pra sempre** pro mesmo número (`numero` é UNIQUE) —
  por isso `criado_em` não serve pra "quando abriu o atendimento"; use `aberta_em`
  (NULL = sem atendimento aberto; mensagem de cliente/atendente abre, finalizar/voltar ao início
  do fluxo fecha, mensagem do bot não mexe).
- **Baileys é não oficial** (engenharia reversa do WhatsApp Web): corrupção de sessão (Bad MAC)
  acontece, mas às vezes é bug nosso disfarçado — quando um campo some depois de atualizar a lib,
  olhar o código em `node_modules/@whiskeysockets/baileys`.
- **Python no Windows** não abre arquivos do scratchpad (caminho > 260 caracteres) nem o `/tmp`
  do Git Bash — pra scripts auxiliares, usar arquivo temporário dentro do projeto e apagar depois.

## Arquivos principais
- `src/bot.js` — conexão com o WhatsApp, recebe mensagens, grava nome do perfil (pushName).
- `src/modo-teste.js` — regra do `NUMEROS_TESTE` (chegando e saindo).
- `src/flow-engine.js` — motor do fluxo do bot (estado em memória).
- `src/conversas.js` — banco: conversas, mensagens, fila, finalizadas, busca, nome do contato.
- `src/routes/fila.js` + `src/views/fila/lista.ejs` + `public/js/fila-lista.js` /
  `fila-responder.js` / `notificacoes.js` — tela da Fila.
- `src/routes/configuracoes.js` + `src/views/configuracoes/editar.ejs` + `src/negocio.js`
  (padrões dos campos novos em `PADROES`).
- Jobs periódicos (setInterval, iniciados em `src/app.js`): `inatividade.js`,
  `fechamento-automatico.js`, `avaliacao-vencida.js`, `backup.js` (diário, 30 dias),
  `retencao.js` (anonimiza conversa sem atividade há 12 meses).
- `.env` (não commitado) — `PORTA`, `NUMEROS_TESTE`, `SESSION_SECRET`, `NUMERO_ATENDENTE`.
- `config/negocio.json` — dados reais do negócio, **NUNCA fazer `git add` nele** (pra atualizar
  o template versionado sem tocar na cópia de trabalho: `git hash-object -w` +
  `git update-index --cacheinfo`).
- `data/` (ignorada pelo git) — banco `chatdigital.db`, `backups/`, `copias/`.

## Ideias que ficaram no ar (não implementar sem o Paulo pedir)
- Demo sem WhatsApp + teste de 30 dias, relatório de conversas e API oficial do WhatsApp: cards
  no Trello (Nazagas). Consulta/registro de marca no INPI: card no board PAULO.
- Campo em Configurações pro número de "chamar direto" (`{{negocio.numero_atendente_legivel}}`),
  que hoje só vem de `NUMERO_ATENDENTE` no `.env`.
- Fechar o banco no `after()` dos testes pra sumir o `EPERM`.

## Como testar
1. `npm start` (porta 3001); no painel, Configurações > WhatsApp pra escanear o QR se precisar.
2. Testar só com os números de `NUMEROS_TESTE`.
3. Mudou `src/*.js`? Reiniciar o servidor (Node cacheia `require`). `views/*.ejs` e `public/*`
   valem com F5.
4. Pra conferir visual sem logar com a senha do Paulo: renderizar a view com `ejs.renderFile` e
   dados de exemplo em `public/_previa/`, abrir no navegador e apagar a pasta depois.
5. Quando o Claude roda o servidor em segundo plano, o log vai pra
   `%TEMP%\chatdigital-server.log` (e `.err.log`).
