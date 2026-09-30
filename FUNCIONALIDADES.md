# ChatDigital — funcionalidades, menu por menu

Anotações de base pro wiki: o que cada tela faz, pra quem é, e o que o sistema faz sozinho.
Atualizar sempre que uma funcionalidade nova entrar (o histórico técnico fica em
`RESUMO_SESSAO.md`).

---

## Acesso
- **Primeiro acesso (`/setup`)**: cria o primeiro administrador. Só aparece enquanto não existe
  nenhum atendente cadastrado.
- **Login**: e-mail e senha. Depois de 5 tentativas erradas, o e-mail fica bloqueado por 15 min.
- **Sair**: botão no rodapé da barra lateral, embaixo do nome de quem está logado.
- **Barra lateral recolhível**: o ☰ no topo esconde os textos e deixa só os ícones (a escolha
  fica lembrada no navegador).

## Permissões
- **Administrador** tem acesso a tudo.
- **Atendente** tem só o que o admin marcar no cadastro dele. Por padrão: responder e finalizar
  conversas. Opções:
  - Ver Painel (resumo/gestão)
  - Cadastrar e gerenciar Atendentes
  - Cadastrar e gerenciar Setores
  - Ver e editar o Fluxo
  - Ver fila de outros setores (sem isso, vê só o(s) setor(es) dele, as sem setor e as que ele assumiu)
  - Responder conversas
  - Finalizar conversas
  - Ver e editar Configurações do negócio

---

## Menu: Painel
Resumo rápido da operação (precisa da permissão "Ver Painel"; sem ela, cai direto na Fila).
- Cartões: aguardando resposta, em atendimento, paradas no fluxo, registros de hoje (pedidos
  etc. salvos pelo fluxo), total de atendentes e de setores.
- Situação do WhatsApp (conectado ou não).
- Quem está online agora (quem está com o painel aberto).

## Menu: Fila (a tela principal do atendente)
**Lista de conversas (lado esquerdo)**
- **Filtros** (duas linhas): **Minhas** (as que você está atendendo) · **Na fila** (o bot passou
  pra atendente e ninguém assumiu ainda) · **No bot** (cliente parou no meio do fluxo do bot) ·
  **Finalizadas** · **Todas** (tudo em andamento, sem as finalizadas). O número ao lado é a
  quantidade. "Na fila" fica vermelho quando tem gente esperando e você está olhando outro filtro.
- A fila lembra o último filtro e setor escolhidos.
- **Busca por número ou nome**: filtra enquanto digita; não diferencia maiúscula nem acento e
  acha o número com ou sem o nono dígito. Em Finalizadas, procura no histórico inteiro (a lista
  mostra só as 50 mais recentes).
- **Setor**: botão com ícone de filtro; mostra o nome do setor escolhido quando tem um.
- **Cada conversa** mostra: número · nome do cliente, "há X min" (anda sozinho), última mensagem
  ("Você:" / "Bot:" quando não foi o cliente), setor e a **bolinha**.
- **Bolinha**: aparece só quando é a vez do atendente responder. Amarela/vermelha conforme o
  tempo que o cliente está esperando (tempos em Configurações > Fila de atendimento). Quem espera
  há mais tempo fica em cima.
- **No bot**: cada conversa tem o botão **Puxar**, que tira do bot e assume na hora.

**Conversa aberta (lado direito)**
- **Topo fixo**: número · nome do cliente, situação ("Atendendo: Fulano · Setor", "Na fila…",
  "Com o bot", "Finalizada") e os botões **Assumir** / **Puxar pra mim**, **Transferir**
  (outro setor e, se quiser, um atendente específico) e **Finalizar**.
- **Lápis ao lado do nome**: troca o nome do cliente, quantas vezes quiser. Em branco volta pro
  nome do perfil do WhatsApp.
- **Histórico**: só ele rola; abre já na última mensagem. Cliente em cinza, bot em azul-marinho,
  atendente em verde com o nome de quem respondeu. Mostra negrito/itálico/riscado como o WhatsApp,
  imagens, vídeos, áudios e link pra PDF.
- **Responder** (quando a conversa está com você): emoji, anexo (imagem, vídeo, áudio ou PDF),
  gravar áudio pelo microfone (com cronômetro e cancelar), texto e Enviar.
- **Finalizar**: manda a mensagem de encerramento e, se configurada, a pesquisa de satisfação.
  A nota que o cliente mandar em até 30 min é agradecida e registrada.

**+ Nova conversa** (topo da página): chama um cliente que ainda não escreveu. Confere se o número
tem WhatsApp, já abre a conversa assumida por quem criou e manda a primeira mensagem (opcional).

**Avisos de mensagem nova**: bipe + aviso na tela + notificação do Windows (botão "🔔 Ativar
avisos na tela" na barra lateral). Com o painel aberto em várias abas, avisa uma vez só. Se você
estiver com uma resposta digitada, mostra "Chegou mensagem nova… Atualizar" em vez de recarregar.

## Menu: Atendentes
- Lista com nome, e-mail, papel, status (ativo/inativo), último login e bolinha de online.
- Cadastrar / editar: nome, e-mail, senha, papel (admin ou atendente), setores e permissões.
- Ativar / desativar com um clique (não apaga). O sistema não deixa remover o último admin ativo,
  e um atendente comum não consegue se promover a admin.

## Menu: Setores
- Criar e renomear setores (ex.: Geral, Vendas, Suporte). O setor "Geral" sempre existe (é pra
  onde o fluxo padrão transfere).
- Os setores servem pra: separar a fila, definir quem vê o quê (atendente x setor) e pra onde o
  bot/inatividade transfere.

## Menu: Fluxo (editor visual do bot)
- Quadro com blocos ligados por setas; arrasta a bolinha de saída até a entrada de outro bloco
  pra conectar, clica na linha pra apagar. Botão **Salvar** grava o fluxo.
- Tipos de bloco: **Mensagem**, **Pergunta** (opções numeradas ou texto livre, pode guardar a
  resposta numa variável), **Condição**, **Horário** (dentro/fora do horário de funcionamento),
  **Transferir** (pra um setor), **Salvar registro** (ex.: pedido), **Chamar API**, **Fim**.
- Variáveis nos textos: `{{negocio.nome}}`, `{{negocio.horario_funcionamento}}`,
  `{{negocio.endereco}}`, `{{negocio.formas_pagamento}}`, `{{negocio.numero_atendente_legivel}}`,
  `{{vars.X}}`. Se a variável estiver vazia, a linha inteira não é mandada.
- Palavras que reiniciam o bot (ex.: "menu", "oi") — mas **não** quando a conversa está com
  atendente.

## Menu: Configurações
- **Dados do negócio**: nome, horário, endereço, formas de pagamento.
- **Mensagens automáticas**: boas-vindas do atendente (ao assumir), encerramento (ao finalizar),
  pesquisa de satisfação, avaliação não respondida (30 min depois da pesquisa), sem atendente
  disponível (ninguém do setor online). Em branco = não manda.
- **Fila de atendimento**: minutos pra bolinha ficar amarela e vermelha.
- **Cliente parado no meio do bot**: minutos até o lembrete + texto do lembrete; minutos até
  desistir; ao desistir, **reiniciar o fluxo** (em silêncio) ou **transferir pra um atendente**
  (setor e mensagem pro cliente).
- **Fechamento automático**: fecha o atendimento aberto há mais de N horas (padrão 24; 0 = nunca),
  contando desde a abertura, com mensagem opcional.

### Configurações > WhatsApp
- Mostra se está conectado; quando não está, mostra o QR Code pra escanear (Aparelhos
  conectados > Conectar aparelho), atualizando sozinho.

---

## O que o sistema faz sozinho (sem ninguém clicar)
- **Bot**: responde pelo fluxo; transfere pra atendente quando o fluxo manda ou quando o cliente
  manda mídia (imagem, áudio, PDF...), avisando o cliente.
- **Nome do cliente**: guarda o nome do perfil do WhatsApp (se ninguém trocou pelo lápis).
- **Lembrete e desistência por inatividade** (cliente parado no bot) — ver Configurações.
- **Fechamento automático** do atendimento aberto há tempo demais — ver Configurações.
- **Aviso de avaliação não respondida** 30 min depois da pesquisa.
- **Depois de reiniciar o servidor**: quem estava com atendente continua com atendente (o bot não
  volta a falar).
- **Backup do banco** 1 vez por dia, guardando os últimos 30 dias.
- **Retenção (LGPD)**: conversa sem atividade há 12 meses tem as mensagens apagadas e o número
  anonimizado (os números da estatística continuam).
- **Modo de teste** (só em teste, com `NUMEROS_TESTE`): o bot e as mensagens automáticas só
  falam com os números da lista.
