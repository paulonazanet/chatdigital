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
  - Ver o Relatório (atendimentos, tempos e notas)

---

## Menu: Painel
Resumo rápido da operação (precisa da permissão "Ver Painel"; sem ela, cai direto na Fila).
- Cartões: aguardando resposta, em atendimento, paradas no fluxo, registros de hoje (pedidos
  etc. salvos pelo fluxo), total de atendentes e de setores.
- Situação do WhatsApp (conectado ou não).
- Quem está online agora (quem está com o painel aberto).

## Menu: Relatório
Números do atendimento (só administrador, ou atendente com a permissão "Ver o Relatório").
- **Período**: Hoje, 7 dias, 30 dias ou Mês passado; e filtro por atendente.
- **Cartões**: total de atendimentos (e quantos foram finalizados sem nenhuma resposta do
  atendente), espera na fila até alguém assumir, tempo até a 1ª resposta e nota média da pesquisa
  (com quantas respostas). Os tempos são o valor típico (mediana: metade esperou menos que isso),
  pra um cliente que escreveu de madrugada não distorcer.
- **Atendimentos por dia** (ou por hora, no filtro Hoje): gráfico de barras.
- **Horários de pico**: quadro dia da semana × hora; quanto mais escuro, mais clientes chegaram.
  Mostra das 7h às 19h, ou mais se chegou cliente fora disso.
- **Notas da pesquisa**: data, cliente, atendente e nota (verde 9–10, amarelo 7–8, vermelho 0–6);
  clicar abre a conversa. A nota vale qualquer jeito de responder ("10", "nota 9", "dez").
- Conta como **atendimento** cada vez que o cliente entra na fila (pelo bot) ou que um atendente
  começa a falar com alguém (Nova conversa, Puxar). Atendimentos de antes do Relatório existir
  foram montados pelas mensagens (aproximado: "assumiu" = 1ª resposta).
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
estiver digitando (resposta, anexo ou áudio pendente, "+ Nova conversa" preenchida ou qualquer
campo em foco), mostra "Chegou mensagem nova. Atualizar" em vez de recarregar. O texto da resposta
fica guardado na aba: se a tela recarregar ou você trocar de conversa e voltar, ele continua lá.

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
  manda mídia (imagem, áudio, PDF...), avisando o cliente. Esse aviso ("Recebemos o áudio
  sua!...") só vai quando a mídia chega com o cliente ainda no bot; se a conversa já está com
  atendente, a mídia aparece na tela e o cliente não recebe mensagem automática.
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
