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
- Acesso à VM: `ssh paulo@177.39.103.178` (IP do `nazagas.eunodigital.com`; o `.182` é a VM dos
  cursos). O código fica em **`/opt/chatdigital/app`** (não em `/opt/chatdigital`). Atualizar:
  Parte P do `INSTALACAO_eunodigital.md` (cópia do banco, `git pull`, restart, `journalctl`).
  Em produção o Express guarda as telas (`.ejs`) em cache: **até mudança só de tela precisa de restart**.
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

## Retorno do Carlos (13/10/2026)
1. **Aviso automático de mídia alongava a conversa**: todo áudio/imagem/vídeo do cliente gerava
   "Recebemos o áudio sua!...", mesmo com o Carlos já atendendo. Agora (`src/bot.js`) o aviso só vai
   quando a mídia chega com o cliente no bot (`vinhaDoBot`); com atendente, fica em silêncio. O aviso
   de "sem atendente disponível" segue a regra própria dele. Precisa `git pull` + reiniciar na VM.
2. **Texto da pesquisa de satisfação** ("...nosso atendimento...") pode citar a Naza Gás: não precisa
   de código, é editável em Configurações > Mensagens automáticas.

## Retorno do Carlos (15/10/2026): resposta digitada sumia
Ao chegar mensagem (áudio/imagem/texto) do cliente, a Fila recarregava sozinha e apagava o que o
Carlos estava digitando. Causa (`public/js/notificacoes.js`): `temRascunhoDeResposta` olhava o
1º `textarea[name="texto"]` da página, que é o da "+ Nova conversa" (vazio), não o da resposta;
e só conferia no momento do aviso, não 1,5 s depois, na hora de recarregar. Agora confere a
resposta, anexo/áudio, "+ Nova conversa" e campo em foco, de novo antes de recarregar.
Rede de segurança em `fila-responder.js`: rascunho da resposta em `sessionStorage` por conversa
(volta depois de recarregar; some ao enviar). Testado no navegador com cópia da tela e evento
simulado. Só `public/`: na VM basta `git pull` + restart.

## Menu Relatório (13/10/2026)
- **Livro de atendimentos**: tabela `atendimentos` (1 linha por atendimento; `conversas` é
  reaproveitada pra sempre e não serve pra histórico). Grava em `src/atendimentos.js`, chamado de
  `conversas.js` (entrar na fila em `sincronizarConversa`, assumir, resposta de atendente,
  transferir, `finalizarConversa(id, como)`), `fechamento-automatico.js` ('automatico') e
  `flow-engine.js` (nota da pesquisa → `registrarNota`, lê "10", "nota 9", "dez").
- `origem`: 'cliente' (entrou na fila pelo bot; mede espera) ou 'ativo' (começou pelo atendente).
- **Reconstrução**: no boot, se o livro está vazio, `reconstruirAtendimentosAntigos` monta os
  antigos pelas mensagens (`reconstruido = 1`; fim = encerramento/pesquisa "De 0 a 10"/fechamento
  automático ou prazo de 24h; só entra quem teve resposta de atendente ou está em andamento;
  "assumido" = 1ª resposta; notas vêm de `registros` 'avaliacoes'). Testado numa cópia do banco local.
- Cálculo em `src/relatorio.js` (UTC-3 fixo, mediana pros tempos); tela `views/relatorio.ejs`,
  rota `/painel/relatorio`, permissão nova `ver_relatorio` (admin sempre tem).
- Os testes antigos que não definem `CHATDIGITAL_DB` abrem o banco padrão `data/chatdigital.db`
  (criaram a tabela vazia no banco local; inofensivo). O teste novo fecha o banco no `after()`.

## Decisões do Paulo (não mudar sem perguntar)
- Relatório: só o Paulo (admin) vê; atendente só com a permissão "Ver o Relatório".
- Com atendente, mídia do cliente não gera aviso automático (só quando tira o cliente do bot).
- Botão "+ Nova conversa" continua azul-marinho (laranja foi descartado).
- `aguardandoAvaliacao` (esperando a nota da pesquisa) fica só em memória — reiniciar nos 30 min
  após finalizar pode fazer a nota abrir o menu; aceitável.
- Com atendente, nenhuma palavra ("oi", "menu"...) religa o bot; só finalizar.
- Fechamento automático conta desde a **abertura** do atendimento, não da última mensagem.
- Fila abre no filtro "Minhas" e lembra o último filtro/setor (cookie `filtroFila`).
- Bolinha só aparece quando é a vez do atendente; amarela 0 min / vermelha 10 min (editável).
- Cliente pode ter o nome trocado quantas vezes quiser; em branco volta pro nome do perfil.

## E1, 1ª parte (18/10/2026): notas internas, protocolo, respostas rápidas, motivo de encerramento
Etapa E1 do plano Syntor → ChatDigital (ver `OneDrive\Documentos\claude\ChatDigital\comparacao_syntor_chatdigital.md`).
- **Banco** (`src/db.js`, migrações): `mensagens.interna` (nota interna, remetente 'atendente');
  `atendimentos.protocolo` (AAAAMMDD + id 4 dígitos; preenchido também nos antigos),
  `atendimentos.motivo_id`/`motivo_texto` ("Grupo › Motivo" guardado como texto); tabelas
  `respostas_rapidas` (+ `respostas_rapidas_setores`) e `motivos_encerramento` (2 níveis, `pai_id`).
- **Notas internas**: `registrarNotaInterna` em `conversas.js` não mexe no atendimento. As consultas
  da fila (`listarFila`, `listarConversasComBot`, `listarFinalizadas`) e a reconstrução do livro
  ignoram `interna = 1`. Rotas: `POST /painel/fila/:id/nota` e chave `interna` no `/responder`.
  Transferir grava nota do sistema (`atendente_id` nulo).
- **Protocolo**: gerado em `atendimentos.js` (`inserirAtendimento`). Variáveis novas na boas-vindas e
  nas respostas rápidas (`contextoDaConversa` em `routes/fila.js`): `atendimento.protocolo`,
  `cliente.nome`, `cliente.telefone`, `setor.nome`, `saudacao`.
- **Faixas no histórico**: `marcarFaixasDeAtendimento` em `routes/fila.js`. A mensagem do cliente
  que chega com o atendimento anterior já fechado já é do próximo (o atendimento só abre depois
  dela), menos a nota da pesquisa e conversa só com o bot mais de 6 h antes.
- **Respostas rápidas**: `src/respostas-rapidas.js`, rotas `src/routes/respostas-rapidas.js`
  (`/painel/respostas-rapidas`, permissão nova `gerenciar_respostas_rapidas`), telas
  `views/respostas-rapidas/`, script `public/js/respostas-rapidas.js` ("/" + setas + Enter; também
  cuida da chave Nota interna). Os textos vão pra tela já com as variáveis trocadas (JSON no
  `<script id="respostas-rapidas-dados">`). Anexo na resposta rápida: ainda não.
- **Motivos**: `src/motivos-encerramento.js` (lista inicial pra gás, só se a tabela estiver vazia),
  tela `/painel/configuracoes/motivos`, chave `exigir_motivo_encerramento` no `negocio.json`.
- Testes: `test/e1-atendente.test.js` (fecha o banco no `after()`). Conferido no navegador com
  `node src/server.js` + banco e negocio.json de teste (sem WhatsApp; `npm start` aqui conectaria o
  número de produção pela pasta `auth/`).
- **Produção**: mudou `src/` → na VM `git pull` + reiniciar. As migrações rodam sozinhas no boot.

## E1, 2ª parte (18/10/2026): marcadores, fixar conversa, devolver ao bot
- Tabelas `marcadores`, `conversas_marcadores` (marcador fica na conversa = no cliente) e
  `conversas_fixadas` (por atendente). Módulo `src/marcadores.js` (lista inicial só com a tabela vazia).
- `routes/fila.js`: filtro `marcador` (3º campo do cookie `filtroFila`), fixadas no topo em
  `montarListaFila`; rotas `POST /:id/marcadores`, `/:id/fixar`, `/:id/devolver-bot`.
- Devolver ao bot: nota interna + `finalizarConversa(id, 'outro')` + `iniciarFluxo` (novo em
  `flow-engine.js`, executa o fluxo do início) + `sincronizarConversa(..., { vinhaDoBot: true })`.
  Precisa do WhatsApp conectado (manda o menu).
- Cadastro em `/painel/configuracoes/marcadores` (`views/configuracoes/marcadores.ejs`).
- Testes no fim de `test/e1-atendente.test.js`.

## Tela de Configurações reorganizada (18/10/2026, commit 2a2cda6)
- Cartões no topo para as subtelas (WhatsApp, Motivos, Marcadores e, depois, Feriados), atalhos
  para os quadros, quadro "Ao finalizar a conversa", barra de Salvar fixa (`.barra-salvar`) com
  aviso de alteração não salva (`views/configuracoes/aviso-nao-salvo.ejs`, reaproveitado em outras
  fichas). Motivos e Marcadores salvam tudo num botão só (`POST /motivos/salvar`, `/marcadores/salvar`,
  campos `nome_<id>`/`ativo_<id>` ligados a um form vazio por `form="..."`).
- Em produção a VM foi atualizada às 21:03 (E1 1ª e 2ª parte subiram junto).

## E1, 3ª parte (18/10/2026): o que faltava da E1
- **Responder citando / reações / reenviar**: colunas novas em `mensagens` (`wa_id`, `wa_de_mim`,
  `citada_id`, `reacao_cliente`, `reacao_atendente`, `falha`). `registrarMensagem` ganhou o 6º
  parâmetro `extra` ({ waId, deMim, citadaId, falha, semAtendimento }) e devolve o id. Em
  `routes/fila.js`: `enviarConteudo` (texto/mídia com `quoted`), `POST /:id/reagir`,
  `/:id/reenviar/:mensagemId`, `/:id/descartar/:mensagemId`. O arquivo de mídia é salvo **antes**
  de mandar, pro Reenviar usar (`lerArquivoDeMidia` em `midia.js`). Mensagem com `falha = 1` não
  conta como resposta (fila, Relatório) até ser reenviada (`marcarReenviada`). Só mensagens novas
  têm `wa_id` (as antigas não mostram Responder/Reagir).
- **bot.js**: o corpo do `messages.upsert` virou `tratarMensagemRecebida(sock, msg, negocio, fluxo)`
  (exportada, testável sem WhatsApp). Trata `reactionMessage` (reação do cliente), citação
  (`contextInfo.stanzaId` → `citada_id`) e a situação do contato.
- **Contatos**: a ficha mora na linha de `conversas` (colunas `email`, `documento`, `endereco`,
  `observacoes`, `situacao_contato` normal/ignorado/bloqueado, `consentimento` + datas). Tags em
  `tags_contato` + `conversas_tags`. Módulo `src/contatos.js`, rotas `src/routes/contatos.js`
  (permissão nova `gerenciar_contatos`), telas `views/contatos/`. Ignorado: guarda a mensagem com
  `semAtendimento` (não abre `aberta_em`, então o fechamento automático não mexe), sem bot e sem fila.
  Bloqueado: nada é guardado. `retencao.js` agora também apaga a ficha e o `numero_exibicao`.
  `src/whatsapp-numero.js` (`resolverNumeroNoWhatsApp`) é usado pela "+ Nova conversa" e pelo
  "Novo contato".
- **Feriados**: tabela `feriados`, módulo `src/feriados.js` (importar nacionais com Páscoa
  calculada, `feriadoAgora`), telas em `/painel/configuracoes/feriados`. O bloco `horario` do fluxo
  vai pelo `fora` num feriado sem expediente (mensagem do feriado antes).
- **Horário por setor**: colunas `setores.horario` (JSON de janelas no formato do bloco Horário) e
  `mensagem_fora_horario`. Regra das janelas foi para `src/horario.js` (`dentroDasJanelas`), usada
  pelo fluxo e por `setorAberto` (`setores.js`). `sincronizarConversa` devolve
  `mensagemForaDoHorario` quando a conversa entra na fila de um setor fechado; o bot manda ela no
  lugar do "sem atendente disponível". Tela `/painel/setores/:id`.
- **Blocos do fluxo**: `aguardar` (espera a resposta, guarda em `variavel`), `nota` (nota interna
  com variáveis; usa `require('./conversas')` dentro da função por causa do require circular) e
  `transferir_atendente` (`estado.atendenteId`; `sincronizarConversa` já põe "atendendo" com ele).
  Editor: `GET /painel/fluxo/opcoes` (atendentes e setores para os campos de escolha).
- CSS: `[hidden] { display: none !important; }` global (vários elementos com display próprio
  apareciam mesmo escondidos).
- Testes: `test/e1-final.test.js` (10 testes). Total: 63 passam; as 8 "falhas" são o `EPERM` do
  Windows ao apagar a pasta temporária dos testes antigos (já existia).
- **Produção**: `git pull` + reiniciar na VM; as migrações rodam sozinhas no boot.

## E2, 1ª parte (18/10/2026, branch `e2`): Auditoria, metas e reincidências
A E2 ("Gestão e confiança") está no branch **`e2`**, separado do `main` enquanto o Carlos testa a
E1. Ordem aprovada pelo Paulo: 1ª Auditoria e relatórios; 2ª Equipe ao vivo (pausa, limite, alertas,
painel da TV por link próprio sem senha); 3ª Fluxo com segurança (testar, versões, importar/exportar,
fluxos prontos de gás, loja, clínica, provedor e delivery); 4ª Acesso e manutenção (papéis,
restrição de login, status do sistema, importar/exportar contatos).
- **Relatório com abas** (`views/relatorio/abas.ejs`): Resumo (`/painel/relatorio`), Auditoria
  (`/painel/relatorio/auditoria`) e Reincidências (`/painel/relatorio/reincidencias`), todas na
  permissão `ver_relatorio`.
- **`src/relatorio.js`**: `temposDoAtendimento` (espera, 1ª resposta, duração = assumido →
  finalizado), `lerMetas` (do `negocio.json`), `compararComMeta` (mediana + % dentro + ok),
  `tabelaPorAtendente`, `listarReincidencias` (atendimento de origem 'cliente' aberto até N dias
  depois do último finalizado da mesma conversa), `formatarIntervalo`, `formatarDataHoraCompleta`.
  `montarRelatorio` devolve `esperaFila`/`primeiraResposta`/`duracao` como objeto
  `{ texto, meta, dentro, ok }` (antes era só o texto).
- **`src/auditoria.js`**: `lerFiltros` (datas em dia de Recife; protocolo ignora as datas),
  `listarAuditoria` (50 por página), `exportarAuditoriaCsv` (";" + BOM; protocolo como `="..."`
  pro Excel não virar 2,02E+11; célula começando com = + - @ ganha `'` na frente),
  `detalheDoAtendimento`, `conversaEmTexto`.
- **`marcarFaixasDeAtendimento` mudou de `routes/fila.js` para `src/atendimentos.js`** e agora
  devolve também `atendimentoId` em cada mensagem (a Auditoria filtra as mensagens por ele). A Fila
  continua igual.
- **Metas**: campos novos no `negocio.json` (`meta_espera_minutos`, `meta_primeira_resposta_minutos`,
  `meta_duracao_minutos`, `meta_nota`, `reincidencia_dias`; padrões em `PADROES` de `negocio.js`).
  Tela `GET/POST /painel/configuracoes/metas` (`views/configuracoes/metas.ejs`), cartão novo em
  Configurações (`.cartoes-config` virou `auto-fit` para caber 5).
- Rotas da Auditoria: `/auditoria/exportar.csv`, `/auditoria/:id`, `/auditoria/:id/imprimir`
  (`?imprimir=1` chama a impressão sozinho; página sem menu, CSS próprio de impressão),
  `/auditoria/:id/conversa.txt`.
- Testes: `test/e2-gestao.test.js` (7 testes). Total: 70 passam; as 8 "falhas" são o `EPERM`
  antigo do Windows.
- Painel de teste da E2: worktree em `.claude/worktrees/e2`, configuração `painel-e2` (porta 3057)
  no `.claude/launch.json` da pasta principal, com cópia própria do banco de teste.

## E2, 2ª parte (18/10/2026, branch `e2`): equipe ao vivo
- **Banco** (`db.js`): `atendentes.limite_conversas` (0 = sem limite), `motivos_pausa` (nome,
  `limite_minutos`, ativo; vem com 5 motivos na 1ª vez) e `pausas` (atendente, motivo_texto e
  limite copiados do motivo, `inicio`, `fim` NULL = em pausa).
- **`src/equipe.js`**: motivos de pausa, `iniciarPausa`/`encerrarPausa`/`pausaAtual`,
  `podeReceberConversa(id)` (em pausa ou no limite → `{ ok: false, motivo }`), `situacaoDaEquipe()`
  (livre/atendendo/limite/pausa/offline, usa `presenca.js`) e `resumoDePausas` (Relatório). Não
  pode dar `require` em `atendentes.js` (circular): usa SQL direto.
- **Onde a regra vale**: `haAtendenteDisponivel` (atendentes.js) ignora quem não pode receber;
  `sincronizarConversa` só entrega pelo bloco "Transferir para atendente" se `podeReceberConversa`;
  em `routes/fila.js`, `impedimentoParaPegar` (assumir, puxar, nova conversa; pausa termina sozinha
  ao pegar; reassumir a própria não conta) e a checagem no transferir para atendente. Logout
  encerra a pausa (`routes/auth.js`).
- **Rotas**: `POST /painel/fila/pausa` (`motivo_id`, `voltar` só aceita `/painel/fila...`),
  `POST /painel/fila/pausa/voltar`.
- **`src/alertas.js`**: `calcularAlertas()` (fila_espera, fila_cheia, sem_resposta_<id>,
  pausa_<id>; `para` 'todos' | 'gestao' + `atendenteId`), `inicioDaEspera(c)` (o mais recente entre
  `esperando_desde` e `aberta_em`: uma mensagem solta de atendimento antigo não conta),
  `checarAlertas()` emite `alerta` no barramento quando aparece, piora (`nivel` maior) ou a cada
  15 min; `iniciarChecagemAlertas()` (1 min) no `app.js`. SSE manda `event: alerta` só pra quem
  é (`alertaParaAtendente`); `public/js/notificacoes.js` toca o bipe e mostra o aviso **sem
  recarregar**. Campos do `negocio.json`: `alerta_fila_minutos`, `alerta_fila_quantidade`,
  `alerta_sem_resposta_minutos` (0 = desligado, padrão).
- **Painel da TV**: `src/routes/tv.js` montado em `/tv` **antes do login** (`server.js`);
  `negocio.painel_tv_token` (`crypto.randomBytes(18)` base64url; comparação com `timingSafeEqual`;
  null = desligado). `GET /tv/:codigo` (view `tv.ejs`, página própria, escura, sem menu) e
  `/tv/:codigo/dados` (JSON, a página busca a cada 15 s). Só números e nomes da equipe.
  Configurações > Painel da TV gera, troca e desliga.
- Telas: `configuracoes/pausas.ejs`, `configuracoes/painel-tv.ejs`, cartões novos em
  Configurações, faixa de pausa/alertas e botão Pausar na Fila, "Equipe agora" no Painel, limite no
  cadastro de Atendentes, tabela Pausas no Relatório.
- Testes: `test/e2-equipe.test.js` (8 testes). Total: 78 passam; as 8 "falhas" são o `EPERM` antigo.

## E2, 3ª parte (18/10/2026, branch `e2`): fluxo com segurança
- **`flow-engine.js`**: `executar(estado, contexto, fluxo, simulacao)` — com a lista `simulacao`,
  os blocos `salvar`, `nota` e `api` não gravam/chamam nada, só registram um evento (a API segue por
  `proximo`); `horario`, `transferir`, `transferir_atendente` e `fim` também registram evento. O
  miolo de `processarMensagem` virou `continuarFluxo` (mesmo comportamento) e
  `simularMensagem({ estado, texto, negocio, fluxo })` usa um estado que vem do navegador (só `no`,
  `vars`, `aguardando`, `humano`, `setor`; `no` inexistente volta pro início) e devolve
  `{ resposta, estado, eventos, no }`. Não toca no `Map` das conversas de verdade.
- **Rotas** (`routes/fluxo.js`, permissão `editar_fluxo`): `POST /testar` (fluxo da tela + estado +
  texto), `POST /conferir` (valida arquivo e lista setores que faltam), `GET /exportar`,
  `GET /modelos`, `GET /modelos/:id`, `GET /versoes`, `GET /versoes/:id/baixar`,
  `POST /versoes/:id/restaurar`. `POST /salvar?origem=modelo|importado&detalhe=…` grava a versão.
- **`src/fluxo-versoes.js`** + tabela `fluxo_versoes` (fluxo inteiro em JSON, quem, origem; só as
  últimas 100). Na 1ª vez guarda o fluxo que já estava em uso ("Como estava antes do histórico").
- **`src/modelos-fluxo.js`**: os 5 fluxos prontos (gas, loja, clinica, provedor, delivery) em JS,
  com `montarLayout` (colunas por distância do início) e `setoresQueFaltam`. Usam setor "Geral",
  menos o provedor (Suporte, Financeiro, Vendas).
- **Editor** (`views/fluxo/editor.ejs`, `public/js/editor-fluxo.js`): botão ▶ Testar (painel
  `.simulador` no lugar do painel de edição; `.no-simulado` no bloco atual), menu **Mais ▾**
  (Fluxos prontos em `<dialog>`, Importar de arquivo, Exportar, Versões), faixa `#faixa-editor`
  com o aviso do fluxo carregado, `origemPendente` vai no Salvar.
- **Painel de teste**: `painel-e2` agora tem `CHATDIGITAL_FLUXO` apontando para uma cópia (salvar no
  editor não mexe no `config/fluxo.json` do repositório).
- Testes: `test/e2-fluxo.test.js` (7 testes). Total: 85 passam; as 8 "falhas" são o `EPERM` antigo.
- Não feito (fica para depois, se pedirem): desfazer/refazer e copiar/colar blocos no editor.

## E2, 4ª parte (18/10/2026, branch `e2`): acesso e manutenção
- **Banco**: `atendentes.grupo_id`, `acesso_horario` (JSON de janelas, NULL = qualquer hora),
  `acesso_ips` (um por linha, NULL = qualquer IP); tabelas `grupos_permissao` (vem com Atendente e
  Gerente) e `acessos` (evento: entrou, saiu, senha_errada, bloqueado_tentativas,
  bloqueado_horario, bloqueado_ip, desconectado; IP e user-agent; 90 dias).
- **Grupos** (`src/grupos-permissao.js`): as permissões do grupo são **copiadas** para
  `atendentes.permissoes` (ao salvar o atendente com grupo e ao salvar o grupo), então
  `temPermissao` não mudou. `permissoesComGrupo` em `atendentes.js`. Rotas
  `/painel/atendentes/grupos` (POST só admin).
- **Acesso** (`src/acesso.js`): `verificarAcesso(atendente, { ip })` (admin sempre passa; IP com
  "::ffff:" limpo; regra terminada em "." ou "*" é faixa). Chamado no login (`routes/auth.js`, que
  também grava o histórico) e em **toda requisição** em `carregarAtendenteLogado` (`sessao.js`):
  fora do horário limpa o cookie e `exigirLogin` manda para `/login?fora=1`.
  `horarioDoCorpo`/`horarioDasJanelas` saíram de `routes/setores.js` para `src/horario.js` (o
  formulário de horário é o mesmo do setor). Página `/painel/atendentes/acessos`.
- **Status do sistema** (`src/status-sistema.js`, `/painel/configuracoes/status`): WhatsApp,
  `PRAGMA quick_check` + tamanho do banco (com -wal), `fs.statfsSync` do disco do banco, último
  arquivo de `backups/`, versão do package + commit lido do `.git` (sem rodar git) + memória.
- **Contatos por planilha** (`src/contatos-planilha.js`): `exportarCsv` (usa `listarContatos` com
  `porPagina` alto; telefone como `="..."`), `lerPlanilha` (CSV com ";" ou ","; aspas; títulos
  sem acento: nome, telefone/celular/whatsapp, email, documento/cpf/cnpj, endereco, observacoes/obs,
  tags, consentimento), `conferir` (compara pela `formaCurtaNumeroBr`, acha repetidos e inválidos),
  conferência guardada em memória por 30 min (token só do mesmo atendente, uma vez), `aplicar`
  (completa vazios ou troca; tags somadas; consentimento só liga; novos via
  `resolverNumeroNoWhatsApp`). Rotas `/painel/contatos/exportar.csv`, `/importar`,
  `/importar/confirmar` (multer, 2 MB).
- Testes: `test/e2-acesso.test.js` (7 testes). Total: 92 passam; as 8 "falhas" são o `EPERM` antigo.
- Não feito (fica para depois, se pedirem): uma sessão por usuário (derrubar o login antigo ao
  entrar em outro lugar).

## E3, 1ª parte (19/10/2026, branch `e3`, feito a partir do `e2`): lembretes e retornos
A E3 fica no branch **`e3`**, criado a partir do `e2` (decisão do Paulo: a E2 entra antes; juntar
o e3 depois do e2 não dá conflito). Partes aprovadas: 1ª lembretes e retornos; 2ª campanhas. A 3ª
(ligação com a GásDigital) ficou para depois, porque a GásDigital ainda não está num servidor e
precisa de uma API do lado dela.
- **Banco**: tabelas `envios` (tipo lembrete/campanha, status pendente/enviado/falhou/pulado/
  cancelado, `wa_id`, entregue/lido/respondido/saiu), `retornos`, `campanhas` (usada na 2ª parte) e
  `conversas.recompra_dias`.
- **`src/envios.js`**: a fila. `processarFila()` (a cada 10 s, `iniciarFilaDeEnvios` no app.js)
  manda **um** pendente por vez se: WhatsApp conectado, não é feriado (opcional), está na janela
  (`envio_janelas`, formato do bloco Horário, hora local do servidor), não passou do
  `envio_limite_dia` e já passou o intervalo sorteado (`envio_intervalo_min/max`, em memória).
  `motivoParaNaoMandar` (anonimizado, bloqueado, ignorado, saiu, em atendimento, modo de teste) →
  status 'pulado'. Mensagem enviada entra no histórico como 'bot'. `atualizarRecibos` lê o
  `messages.update` do Baileys (3 entregue, 4 lido) pelo `wa_id`. `registrarResposta` marca a 1ª
  resposta (até 3 dias) e trata **SAIR** (até 7 dias, fora de atendimento): `consentimento = 0`,
  `optout_em`, cancela os pendentes do cliente.
- **`src/lembretes.js`**: compras = registros "pedidos" (`dados.numero`) + atendimentos com
  `motivo_texto` em `recompra_motivos` (padrão: os com "pedido"); compras a menos de 12 h juntam.
  Prazo = ficha > média (3+ compras, `recompra_usar_media`) > `recompra_dias`. Só até 30 dias depois
  do prazo e um lembrete por compra. `gerarLembretes()` de hora em hora (só com `recompra_ligado`).
- **`src/resposta-envio.js`**: chamado em `tratarMensagemRecebida` (bot.js) **antes** do fluxo:
  SAIR responde a confirmação e para; resposta a lembrete com `recompra_resposta = 'atendente'`
  chama `transferirParaHumano` no `recompra_setor` (o fluxo não roda); campanha (2ª parte).
  `iniciarFluxo` ganhou `bloco` (começar no meio do fluxo).
- **`src/retornos.js`**: `agendarRetorno` (rota `POST /painel/fila/:id/retorno`, dia e hora de
  Recife → ISO com -03:00), `processarRetornos()` a cada minuto: `transferirParaHumano` +
  `assumirConversa` (se ninguém mais está atendendo), nota interna, mensagem (se tiver, como
  'atendente') e evento `atencao` com motivo 'retorno'.
- **Telas**: menu **Campanhas** (`routes/campanhas.js`, `views/campanhas/`, permissão nova
  `gerenciar_campanhas`): Lembretes, Retornos, Envios, Regras de envio. Fila: Ações › Agendar
  retorno e a faixa do retorno marcado (o menu Ações agora rola). Ficha do contato: dias de recompra.
- Testes: `test/e3-lembretes.test.js` (5 testes). Total: 97 passam; as 8 "falhas" são o `EPERM` antigo.
- Painel de teste da E3: `painel-e3` (porta 3058) no `.claude/launch.json` da pasta principal.

## E3, 2ª parte (19/10/2026, branch `e3`): campanhas
- **`src/campanhas.js`**: `publico` (JSON na campanha: `tags`, `modoTags` qualquer|todas,
  `soConsentiu`, `excluirDias`), `montarPublico` (situação normal, não anonimizado, não saiu, tags,
  sem campanha enviada nos últimos N dias, consentimento), `textoParaCliente` (variáveis +
  `textoComSair`), `validar` (frase-chave até 3 palavras, sem sair/parar/stop/cancelar/menu/oi; bloco
  precisa existir), `iniciarCampanha` (põe todos em `envios` com `agendado_para` = começar em; status
  'enviando'), pausar/retomar/cancelar (cancela os pendentes), duplicar, excluir rascunho,
  `enviarTeste` (fora da fila, envio tipo 'teste', não entra nos números), `fraseConfere`.
- **Fila**: `processarFila` só pega envio de campanha com a campanha 'enviando' (pausada fica
  parada); quando acaba o último pendente, a campanha vira 'concluida'.
- **Respostas** (`resposta-envio.js`): campanha com frase-chave → `transferirParaHumano` no
  `setor_frase` ou `{ bloco }` (o bot.js chama `iniciarFluxo` com `bloco`); outra resposta → nota
  "Respondeu à campanha" e segue o fluxo normal.
- **Telas**: aba Campanhas (`/painel/campanhas/lista`, `/nova`, `/campanha/:id` com `/teste`,
  `/iniciar`, `/pausar`, `/retomar`, `/cancelar`, `/duplicar`, `/excluir`), `views/campanhas/
  lista.ejs` e `campanha.ejs` (rascunho editável; depois, só leitura com os números).
- Testes: `test/e3-campanhas.test.js` (5 testes). Total: 102 passam; as 8 "falhas" são o `EPERM` antigo.
- **Não testado com WhatsApp de verdade**: recibo de entregue/lido (`messages.update`) e o ritmo
  real da fila. Ficou para a 3ª parte: ligação com a GásDigital.

## E4, 1ª e 2ª parte (19/10/2026, branch `e4`, feito a partir do `e3`): central de envio e API oficial
- **Mudança de plano (explicada ao Paulo)**: a "base para vários números" virou uma **central de
  envio** com **uma conexão ativa por instalação** (celular ou oficial). Vários números ao mesmo tempo
  ficam inteiros para a 3ª parte (precisa trocar o `UNIQUE(numero)` de `conversas` e a memória do
  motor de fluxo, que é por número).
- **`src/socket-atual.js`**: `definirSocket` (Baileys), `definirCanalOficial`, `definirModo('celular' |
  'oficial')`, `modoAtual()`, e `obterSocket()` devolve a conexão do modo em uso. Todos os pontos que
  mandavam mensagem já usavam `obterSocket()`, então nada mais mudou para eles. O modo é decidido no
  boot (`app.js` lê `negocio.whatsapp_conexao`; com 'oficial' não liga o Baileys).
- **`src/whatsapp-oficial.js`**: config na tabela `whatsapp_oficial` (id 1: numero_id, conta_id, chave,
  segredo_app, codigo_verificacao, versao, e o resultado da conferência), `testarConexao`,
  `criarAdaptador()` com `sendMessage(numero, conteudo, opcoes)` igual ao Baileys (texto, image/video/
  audio/document por buffer → sobe em `/{numero_id}/media` e manda pelo id, `quoted` → `context`,
  `react` → reaction), `enviarModelo`, `onWhatsApp` (sempre "existe"), `sincronizarModelos` (tabela
  `modelos_oficiais`, conta as variáveis {{n}} do corpo), `dentroDaJanela` (24 h da última mensagem do
  cliente), `conferirAssinatura` (X-Hub-Signature-256 com o segredo do app, `timingSafeEqual`),
  `lerWebhook` (Meta → mensagem no formato do Baileys + `baixarMidia()`, e recibos/falhas),
  `traduzirErro` (190 chave, 131047/131026 24 h, 132001 modelo, 131056 limite). Endereço:
  `CHATDIGITAL_META_URL` (testes) ou graph.facebook.com.
- **Webhook** `src/routes/webhook-whatsapp.js` em `/webhook/whatsapp` antes do login: GET confere o
  token de verificação; POST com `express.raw`, confere a assinatura, responde 200 e trata depois
  (`tratarWebhook`: mensagem → `tratarMensagemRecebida` com o adaptador; recibo → `atualizarRecibos`;
  falha → `mensagens.falha = 1` e `envios` 'falhou'). Só trata se o modo em uso for 'oficial'.
- **bot.js**: mídia com `msg.baixarMidia()` (oficial) ou `downloadMediaMessage` (Baileys).
- **Fila**: `viaOficial`, `foraDaJanela`, `modelosAprovados`; `POST /:id/responder` recusa texto fora
  das 24 h; `POST /:id/modelo` (modelo "nome|idioma" + `parametros`), texto do modelo no histórico.
- **Envios**: `envios.modelo` (JSON); `processarFila` pela oficial manda o modelo, ou texto se dentro
  das 24 h, senão 'pulado' com o motivo. **Campanhas**: colunas `modelo_nome`, `modelo_idioma`,
  `modelo_parametros` (com variáveis), `modeloParaCliente`; **lembrete**: `negocio.recompra_modelo`.
  Tela: `views/campanhas/escolher-modelo.ejs`.
- **Telas**: Configurações › WhatsApp (escolha da conexão, dados da Meta, webhook, modelos), Status do
  sistema mostra a API oficial.
- Testes: `test/e4-oficial.test.js` (8 testes, com uma Meta de mentira em `http.createServer`). Total:
  110 passam; as 8 "falhas" são o `EPERM` antigo.
- **Não testado com a Meta de verdade** (depende do Paulo: linha, conta, app, token). Passo a passo:
  `passo_a_passo_meta_E4.md` no OneDrive.

## E4: central do Instagram (19/10/2026, branch `e4`)
Decisão do Paulo: **um app só na Meta** ("ChatDigital"), no portfólio da Nazanet até sair o CNPJ da Eu no
Digital, para todas as instalações. Só o dono do app passa pela verificação e pela análise.
- **`src/central-instagram.js`** (`npm run central-instagram`, porta 3100): app Express separado,
  configurado por `CENTRAL_*` (app ID/secret, verify token, endereço, arquivo de instalações
  `[{id, nome, endereco, segredo}]`, arquivo de dados com conta → instalação). Rotas:
  `GET /instagram/conectar` (pedido da instalação assinado `HMAC(segredo, id.t)`, vale 10 min → login
  `instagram.com/oauth/authorize` com `state` assinado pelo app secret), `GET /instagram/retorno` (troca o
  código em `api.instagram.com/oauth/access_token`, chave longa em `graph.instagram.com/access_token`
  `ig_exchange_token`, `GET /me` user_id/username, `POST /me/subscribed_apps`, anota a conta, entrega
  à instalação em `POST <instalação>/webhook/instagram/conta` assinado com o segredo dela, volta o
  navegador com `?aviso=conectado|cancelado|falhou-central`), `GET/POST /webhook/instagram` (confere a
  Meta com o app secret e repassa cada `entry` à instalação dona da conta, reassinado com o segredo dela).
  URLs trocáveis por `CHATDIGITAL_INSTAGRAM_URL`, `_OAUTH_URL`, `_LOGIN_URL` (testes).
- **Instalação**: `instagram_config.central_url` e `central_instalacao` (o segredo combinado fica em
  `segredo_app`, então o webhook repassado é conferido igual ao da Meta). `usaCentral`,
  `salvarCentral`, `linkDeConexao`, `receberContaDaCentral`, `desconectar`. Rotas: `POST
  /painel/configuracoes/instagram/central`, `GET .../conectar`, `POST .../desconectar`, `POST
  /webhook/instagram/conta`. Tela: "Conectar pelo app do ChatDigital" + app próprio em `<details>`.
- A instalação continua mandando direto ao Instagram com a chave dela e renovando sozinha.
- Testes: `test/e4-central-instagram.test.js` (5, instalação + central + Instagram de mentira). Total:
  129 passam, zero falhas. Passo a passo: `passo_a_passo_instagram.md` (OneDrive).

## E4: Instagram (19/10/2026, branch `e4`)
Pedido do Paulo para a Novanet e para a Naza Gás (cada empresa na sua instalação, com o seu @).
- **API**: Instagram API com login do Instagram (`graph.instagram.com`, v26.0; não precisa de página do
  Facebook). `src/instagram.js`: config (tabela `instagram_config`, id 1; chave e segredo mascarados na
  tela), `testarConexao` (`GET /me`), adaptador `sendMessage` no jeito do Baileys (texto ≤1000 bytes,
  `reply_to`, foto/vídeo/PDF por URL pública `endereco_publico + /uploads/...` com a legenda numa 2a
  mensagem, reação `sender_action react/unreact`, áudio recusado), `perfilDe` (nome e @),
  `lerWebhook` (ignora eco e outra conta; texto, anexos com `baixarMidia`, `reply_to` → citação,
  reação → `reactionMessage`), `renovarChaveSePrecisar` (`/refresh_access_token`, 1x por dia, depois
  de 30 dias). Endereço trocável por `CHATDIGITAL_INSTAGRAM_URL` (testes).
- **Conversa** `"<IGSID>@instagram"` (`ehConversaDeCliente` aceita), `numero_exibicao` = `@usuario`
  (`formatarTelefone` mostra o @). **Canal** em `canais` com `tipo = 'instagram'` (coluna nova; os outros
  são `'celular'`): etiqueta e fluxo próprios; criado ao salvar a configuração. `listarCanais({ tipo })`;
  o app.js só liga Baileys para `tipo 'celular'`; a tela do WhatsApp, a Nova conversa e o Status só
  listam os de celular; o filtro Número da Fila mostra todos.
- **Central** (`socket-atual.js`): com o Instagram configurado, `obterSocket()` devolve um Proxy do
  WhatsApp em uso cujo `sendMessage` manda `@instagram` pelo Instagram (sem WhatsApp, um objeto só com
  `sendMessage`). `obterSocketWhatsapp()` para quem precisa do WhatsApp mesmo (Contatos).
- **Webhook** `src/routes/webhook-instagram.js` em `/webhook/instagram` (antes do login): GET confere o
  token, POST confere `X-Hub-Signature-256` com o segredo do app do Instagram; canal desligado = ignora.
- **24 h**: Fila (faixa e recusa ao responder) e envios (lembrete/campanha pulado) usam
  `oficial.dentroDaJanela`.
- Tela: Configurações › Instagram (+ cartão). Testes: `test/e4-instagram.test.js` (8, Instagram de
  mentira). Total: 124 passam, zero falhas. Não testado com o Instagram de verdade (depende da Meta).

## E4, 3ª parte (19/10/2026, branch `e4`): vários números pelo celular, cada um com o seu fluxo
Pedido do Paulo para a Novanet (dois WhatsApp de suporte, mesmo bot) e pensando em venda (cada
número com o seu fluxo).
- **Modelo escolhido**: continua **uma conversa por cliente** (`conversas.numero` UNIQUE e a memória
  do motor por número, sem reconstruir tabela). A conversa guarda `canal_id` = o número por onde o
  cliente escreveu por último (gravado em `registrarMensagem` com `extra.canalId`); `mensagens.canal_id`
  diz por onde cada mensagem chegou. A resposta sai por esse número; o fluxo é o desse número.
- **Banco**: `canais` (id 1 = "Principal", pasta `auth`; os outros `auth-numero-<id>`; `fluxo_id`),
  `fluxos` (id 1 = Principal, o arquivo `config/fluxo.json`, sem conteúdo; os outros com o JSON),
  `fluxo_versoes.fluxo_id`.
- **`src/socket-atual.js`**: um socket do Baileys por canal; `obterSocket()` pelo celular devolve um
  **roteador** (`sendMessage(numero, …)` escolhe o socket pelo `canal_id` da conversa, cai no Principal),
  então os ~20 lugares que mandam mensagem não mudaram. `socketDoCanal`, `ligarCanal` (app.js registra o
  iniciador; no painel de teste não liga), `desligarCanal`.
- **`src/whatsapp-status.js`**: estado por canal; `obterEstado()` sem número = todos conectados.
- **`src/bot.js`**: `iniciarBot(negocio, fluxo, canal)` com a pasta do canal; `tratarMensagemRecebida(…,
  { canalId })` usa o fluxo do canal; `pararBot(canalId)` (não reconecta). `app.js` liga todos os ativos.
- **`src/fluxo.js`**: `carregarFluxoPorId` (o fluxo leva `_id`, não enumerável, fora do JSON),
  `carregarFluxoDoCanal`, `carregarFluxoDaConversa`, `leitorDeFluxos()` (cache pra listas),
  `salvarFluxoPorId`, `listarFluxos`, `criarFluxo`, `renomearFluxo`, `excluirFluxo`.
  **flow-engine**: o estado guarda `fluxoId`; fluxo diferente (cliente trocou de número) = recomeça,
  menos com atendente ou esperando a nota. Inatividade, fechamento automático, "paradas no fluxo"
  (Fila, Painel), finalizar, devolver ao bot, puxar e retornos usam o fluxo da conversa.
- **Telas**: Configurações › WhatsApp (Números: estado, QR `qr.png?numero=<id>`, nome, fluxo, ligar/
  desligar, adicionar), Fila (etiqueta, filtro `numero` no cookie, número na Nova conversa, "Pelo
  número…"), editor de fluxo (`?fluxo=<id>` em tudo, seletor, Mais › Fluxos), Status do sistema (um
  item por número).
- A API oficial continua sendo uma conexão da instalação inteira (o Principal). Misturar números
  pelo celular e pela API oficial na mesma instalação fica para depois.
- Testes: `test/e4-numeros.test.js` (6 testes). Total: 116 passam, zero falhas.

## Testes sem as 8 falhas de EPERM (19/10/2026)
Os 8 testes antigos (atendimento-avancado, configuracoes, eventos, fila, fluxo-editor, painel,
seguranca, whatsapp) não fechavam o banco antes de apagar a pasta temporária, e o Windows não
deixava apagar. Agora o `after()` fecha o banco, se ele foi aberto. `npm test`: 92 de 92 no `e2`
(no `e3`, 102 de 102; no `e4`, 110 de 110),
**zero falhas** (as notas antigas que falam em "8 falhas de EPERM" ficaram para trás).

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
- `src/conversas.js` — banco: conversas, mensagens, notas internas, fila, finalizadas, busca, nome do contato.
- `src/respostas-rapidas.js`, `src/motivos-encerramento.js`, `src/marcadores.js`, `src/contatos.js`,
  `src/feriados.js` — cadastros da E1. `src/horario.js` — regra das janelas de horário.
- `src/relatorio.js` + `src/auditoria.js` + `src/routes/relatorio.js` + `src/views/relatorio*` —
  menu Relatório (Resumo, Auditoria, Reincidências).
- `src/equipe.js` (pausa, limite, situação da equipe), `src/alertas.js` (alertas de fila),
  `src/routes/tv.js` + `src/views/tv.ejs` (painel da TV).
- `src/fluxo-versoes.js` (versões do fluxo), `src/modelos-fluxo.js` (fluxos prontos),
  `public/js/editor-fluxo.js` (editor, simulador, importar).
- `src/canais.js` (números), `src/socket-atual.js` (central de envio e roteador), `src/whatsapp-oficial.js` (API oficial da Meta),
  `src/routes/webhook-whatsapp.js` (webhook da Meta).
- `src/campanhas.js` (campanhas), `src/envios.js` (fila de envios automáticos), `src/lembretes.js` (recompra), `src/retornos.js`,
  `src/resposta-envio.js` (SAIR e respostas a envios), `src/routes/campanhas.js` (menu Campanhas).
- `src/grupos-permissao.js`, `src/acesso.js` (horário/IP de acesso e histórico),
  `src/status-sistema.js`, `src/contatos-planilha.js` (exportar/importar contatos).
- `src/routes/fila.js` + `src/views/fila/lista.ejs` + `public/js/fila-lista.js` /
  `fila-responder.js` / `notificacoes.js` — tela da Fila.
- `src/routes/configuracoes.js` + `src/views/configuracoes/editar.ejs` + `src/negocio.js`
  (padrões dos campos novos em `PADROES`).
- Jobs periódicos (setInterval, iniciados em `src/app.js`): `inatividade.js`,
  `fechamento-automatico.js`, `avaliacao-vencida.js`, `alertas.js` (1 min), `backup.js` (diário, 30 dias),
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

## Como testar
1. `npm start` (porta 3001); no painel, Configurações > WhatsApp pra escanear o QR se precisar.
2. Testar só com os números de `NUMEROS_TESTE`.
3. Mudou `src/*.js`? Reiniciar o servidor (Node cacheia `require`). `views/*.ejs` e `public/*`
   valem com F5.
4. Pra conferir visual sem logar com a senha do Paulo: renderizar a view com `ejs.renderFile` e
   dados de exemplo em `public/_previa/`, abrir no navegador e apagar a pasta depois.
5. Quando o Claude roda o servidor em segundo plano, o log vai pra
   `%TEMP%\chatdigital-server.log` (e `.err.log`).
