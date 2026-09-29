# ChatDigital — resumo pra continuar com outro modelo (Opus 5.5)

## O que é o projeto
Painel de atendimento via WhatsApp pro Paulo (Nazagas — gás/água). Stack: Node.js + Express +
EJS + SQLite (`node:sqlite`) + Baileys (`@whiskeysockets/baileys`) pra conectar no WhatsApp.
Repositório: `paulonazanet/chatdigital` no GitHub, branch `main`. Projeto local em
`C:\Users\pjnso\Documents\claude\chatdigital`.

Rodando localmente na porta **3001** (nunca mexer em processo na porta 3000, pode ser outra coisa
do Paulo). Comando: `npm start` (roda `node src/app.js`). Painel em http://localhost:3001.

Testes: `npm test` (usa `node:test`). Hoje em dia ~8 arquivos de teste "falham" só por causa de um
erro `EPERM` do Windows ao tentar apagar pasta temp no `after()` — é pré-existente, não é bug de
código (já confirmado via `git stash` em sessão anterior). Os testes de verdade (as asserções)
sempre passam antes desse erro de cleanup.

## Modo de teste (importante!)
Existe um `.env` (não commitado) com `NUMEROS_TESTE=5581996850663,5581994773410` — só esses dois
números recebem resposta automática do bot. Isso existe pra Paulo testar do WhatsApp dele sem
incomodar clientes reais. A lógica fica em `src/bot.js`, função `construirVerificadorNumeroPermitido`.

## Bugs corrigidos HOJE (29/09/2026), em ordem
1. **"AGUARDANDO MENSAGEM" travado por +15min ao iniciar conversa nova** — era corrupção de sessão
   Signal (Bad MAC / No matching sessions / MessageCounterError) nos logs. Causa raiz real: a versão
   do Baileys (`6.7.24`) tinha uma vulnerabilidade de segurança conhecida E bugs de sessão com `@lid`.
   **Fix**: atualizei pra `@whiskeysockets/baileys@7.0.0-rc14` (a mais nova, sem a vulnerabilidade —
   NUNCA usar a `6.17.16`, tem CVE de spoofing de mensagem). Depois de trocar a versão, sempre apagar
   `auth/` e escanear o QR de novo (mudança grande de versão não é confiável só reiniciando).

2. **"+ Nova conversa" cria conversa "fantasma"** — o botão usa `sock.onWhatsApp()` que devolve o
   JID no formato `numero@s.whatsapp.net`, mas quando o cliente responde, a mensagem chega com JID
   `@lid` (um ID interno do WhatsApp, diferente do número). Como o código antigo usava o JID errado
   pra registrar a conversa, a resposta do cliente caía numa conversa diferente (nunca vista) e o
   bot achava que era gente nova. **Fix** em `src/routes/fila.js`, rota `POST /nova`: antes de criar
   a conversa, resolve o `@lid` de verdade via `sock.signalRepository.lidMapping.getLIDForPN(pn)`
   (API nova do Baileys 7.0) e usa esse LID como identificador da conversa, com fallback pro JID
   antigo se não achar.

3. **Resposta do cliente não chegava no painel (sumia sem erro nenhum)** — o Baileys 7.0 **renomeou**
   um campo que a gente usava: `msg.key.senderPn` virou `msg.key.remoteJidAlt`. Esse campo é o número
   de telefone de verdade por trás de um JID `@lid`. Como o código ainda lia `senderPn` (que não
   existe mais na v7), o filtro do "modo de teste" (`numeroPermitido`) nunca reconhecia o número da
   pessoa e **descartava a mensagem em silêncio** (sem log de erro nenhum — por isso foi difícil de
   achar). **Fix** em `src/bot.js`: troquei as 3 ocorrências de `msg.key.senderPn` por
   `msg.key.remoteJidAlt`.

4. **Bot mostrava o menu de novo numa conversa que já estava com atendente (depois de reiniciar)** —
   o estado "humano" vive só na memória (`Map conversas` em `src/flow-engine.js`) e zerava a cada
   restart. Pior: além de mandar o menu, `sincronizarConversa` rebaixava a conversa pra `status =
   'bot'` e `setor_id = NULL`, tirando ela da fila. **Fix**: `restaurarAtendimentosEmAndamento(fluxo)`
   em `src/conversas.js`, chamada em `src/app.js` antes de `iniciarBot`: pega tudo com `status IN
   ('aguardando','atendendo')` e chama `transferirParaHumano(numero, fluxo, setor_nome)` (o nome do
   setor vai junto pra não perder o setor). No boot aparece no log "N conversa(s) com atendente
   restaurada(s)". Teste: `test/restaurar-atendimentos.test.js`.

5. **"+ Nova conversa" logo depois de finalizar: resposta do cliente virava "obrigado pela
   avaliação"** — `transferirParaHumano` agora zera `aguardandoAvaliacao` (em `src/flow-engine.js`).
   Teste em `test/flow-engine.test.js` (`testarNovoAtendimentoCancelaAvaliacao`).

6. **Dois pop-ups por mensagem do cliente** — a mensagem só era gravada uma vez; o aviso duplicava
   porque cada aba do painel aberta tem sua conexão SSE e cada uma tocava bipe + notificação do
   Windows. Agora `src/routes/eventos.js` manda um `id` único por evento (igual pra todas as abas) e
   `public/js/notificacoes.js` usa `navigator.locks` + `tag` da Notification pra avisar uma vez só.
   O aviso flutuante dentro da página continua por aba (só aparece na aba que você está olhando).

## Decidido
- Paulo decidiu (29/09) NÃO persistir `aguardandoAvaliacao` no banco por enquanto — se reiniciar
  nos 30min após finalizar, a nota pode abrir o menu; aceitável.

## Arquitetura rápida (pontos que mais confundem)
- **`@lid` vs `@s.whatsapp.net`**: WhatsApp às vezes identifica o mesmo contato por um ID interno
  (`@lid`) em vez do número de telefone (`@s.whatsapp.net`). As duas pontas (bot recebendo mensagem,
  painel iniciando conversa) precisam concordar em qual JID usar pra mesma pessoa, senão vira
  conversa "fantasma" duplicada. `numero_exibicao` na tabela `conversas` guarda o número legível só
  pra mostrar na tela, não é a chave de verdade.
- **Estado em memória (`flow-engine.js`) vs banco (`conversas.js`)**: são DOIS lugares que guardam
  "onde a conversa está" — o banco é permanente (sobrevive restart), a memória não. Isso já causou
  pelo menos 2 bugs diferentes nesta sessão (esse de hoje, e um anterior onde a nota da pesquisa de
  satisfação reabria o menu).
- **Baileys é uma API não-oficial** (engenharia reversa do WhatsApp Web) — por isso corrupção de
  sessão Signal (Bad MAC etc.) acontece de verdade e não é sempre bug nosso. Mas hoje descobri que
  às vezes SIM é bug nosso mascarado de "coisa estranha do WhatsApp" (o caso do `remoteJidAlt`) —
  vale sempre olhar o código-fonte da lib em `node_modules/@whiskeysockets/baileys` quando um campo
  que a gente lê some ou fica `undefined` depois de atualizar a versão.

## Arquivos principais
- `src/bot.js` — conexão com WhatsApp, recebe mensagens, filtro de modo de teste.
- `src/routes/fila.js` — rotas do painel (fila de atendimento, nova conversa, responder, finalizar).
- `src/flow-engine.js` — motor do fluxo do bot (estado em memória).
- `src/conversas.js` — acesso ao banco (tabela `conversas` e `mensagens`).
- `src/midia.js` — upload/conversão de mídia (imagem/vídeo/áudio/PDF).
- `src/avaliacao-vencida.js`, `src/inatividade.js` — jobs periódicos (setInterval).
- `.env` (não commitado) — `PORTA`, `NUMEROS_TESTE`, `SESSION_SECRET`.
- `config/negocio.json` — dados reais do negócio do Paulo, **NUNCA fazer `git add` direto nesse
  arquivo** (ele edita com dados reais). Pra atualizar o template versionado no Git sem tocar na
  cópia de trabalho, usar `git hash-object -w` + `git update-index --cacheinfo`.

## Pendências no Trello (não implementar sem confirmar, só lembrar que existem)
- Configurações de inatividade (tempo + o que fazer)
- Fechamento automático da conversa após 24h aberta
- Mostrar o nome do atendente na mensagem (hoje só mostra "atendente")

## Como testar
1. Rodar `npm start` (porta 3001).
2. No painel, Configurações > WhatsApp — escanear QR se precisar.
3. Testar só com os números em `NUMEROS_TESTE` do `.env`.
4. Sempre que mudar código de `src/*.js` (não `views/*.ejs` nem `public/*`), precisa reiniciar o
   servidor pra valer (Node cacheia `require`).
5. Log do servidor fica sendo redirecionado pra `/tmp/chatdigital-server.log` quando eu (Claude)
   rodo em background — útil pra debugar erro de decrypt/sessão do WhatsApp.
