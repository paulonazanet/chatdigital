# ChatDigital — funcionalidades, menu por menu

Anotações de base pro wiki: o que cada tela faz, pra quem é, e o que o sistema faz sozinho.
Atualizar sempre que uma funcionalidade nova entrar (o histórico técnico fica em
`RESUMO_SESSAO.md`).

---

## Acesso
- **Primeiro acesso (`/setup`)**: cria o primeiro administrador. Só aparece enquanto não existe
  nenhum atendente cadastrado.
- **Login**: e-mail e senha. Depois de 5 tentativas erradas, o e-mail fica bloqueado por 15 min.
- **Horário e local de acesso** (por atendente, em Atendentes; não vale para administrador): fora do
  horário a pessoa não entra e, se estiver no painel, é desconectada na próxima tela ("acabou o seu
  horário de acesso"); com IPs liberados, só entra desses endereços.
- **Sair**: botão no rodapé da barra lateral, embaixo do nome de quem está logado.
- **Barra lateral recolhível**: o ☰ no topo esconde os textos e deixa só os ícones (a escolha
  fica lembrada no navegador). A página em que você está fica marcada no menu com um traço laranja.
- **No celular** (tela até 760 px): o menu vira uma faixa fina no topo; o ☰ abre o menu por cima da
  página (fecha tocando fora, no Esc ou escolhendo a página). As tabelas deslizam para o lado, os
  cartões de números ficam em duas colunas, e os menus que abrem por cima (Ações, Transferir, nome,
  Nova conversa, Pausar) sobem do pé da tela. Na **Fila**, aparece a lista ou a conversa, uma de cada
  vez, com **‹ Conversas** para voltar. No **editor de fluxo**, os blocos ficam numa faixa em cima, o
  quadro no meio e a edição embaixo (com o aviso de que fluxo grande se monta no computador).

## Permissões
- **Administrador** tem acesso a tudo.
- **Grupos de permissão** (Atendentes > Grupos de permissão): vêm "Atendente" (responder e finalizar)
  e "Gerente" (painel, fila de outros setores, responder, finalizar, relatório, respostas rápidas,
  contatos). No cadastro, escolher um grupo dá à pessoa as permissões dele (as caixas ficam travadas);
  mudar o grupo muda na hora todos que estão nele; excluir o grupo deixa cada um com as que tinha.
  Só o administrador cria e muda grupos.
- **Atendente** tem só o que o admin marcar no cadastro dele (ou o do grupo). Por padrão: responder e finalizar
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
  - Cadastrar e editar Respostas rápidas
  - Ver e editar Contatos (cadastro, ignorar, bloquear, tags)
  - Campanhas e lembretes (lembrete de recompra, retornos, campanhas, envios)

---

## Menu: Painel
Resumo rápido da operação (precisa da permissão "Ver Painel"; sem ela, cai direto na Fila).
- Cartões: aguardando resposta, em atendimento, paradas no fluxo, registros de hoje (pedidos
  etc. salvos pelo fluxo), total de atendentes e de setores.
- Situação do WhatsApp (conectado ou não).
- **Alertas** de fila (faixa amarela), quando ligados em Configurações > Pausas e alertas.
- **Equipe agora**: quem está com o painel aberto e a situação de cada um: livre, atendendo (com
  quantas conversas e o limite), no limite ou em pausa (motivo e há quantos minutos; vermelho
  quando passou do limite do motivo).

## Menu: Relatório
Números do atendimento (só administrador, ou atendente com a permissão "Ver o Relatório"). Três
abas: **Resumo**, **Auditoria** e **Reincidências**.

### Relatório > Resumo
- **Período**: Hoje, 7 dias, 30 dias ou Mês passado; e filtro por atendente.
- **Cartões**: total de atendimentos (e quantos foram finalizados sem nenhuma resposta do
  atendente), espera na fila até alguém assumir, tempo até a 1ª resposta, **duração do
  atendimento** (de assumir até finalizar), nota média da pesquisa (com quantas respostas) e
  **quantos clientes voltaram** em até X dias (leva para a aba Reincidências). Os tempos são o valor
  típico (mediana: metade esperou menos que isso), pra um cliente que escreveu de madrugada não
  distorcer.
- **Metas** (definidas em Configurações > Metas): o cartão fica **verde** quando o tempo típico está
  dentro da meta e **vermelho** quando passa, com "meta 10 min · 75% dentro" (quantos % dos
  atendimentos ficaram dentro). A nota fica vermelha abaixo da média mínima. Sem meta, sem cor.
- **Pausas**: por atendente, quantas pausas, tempo total, maior pausa, quantas passaram do limite
  e o tempo por motivo.
- **Por atendente** (só em "Todos os atendentes"): uma linha por atendente com atendimentos, espera,
  1ª resposta, duração, nota média e finalizados sem resposta, com as mesmas cores das metas.
  Clicar no nome abre o Relatório só dele.
- **Atendimentos por dia** (ou por hora, no filtro Hoje): gráfico de barras.
- **Horários de pico**: quadro dia da semana × hora; quanto mais escuro, mais clientes chegaram.
  Mostra das 7h às 19h, ou mais se chegou cliente fora disso.
- **Notas da pesquisa**: data, cliente, atendente e nota (verde 9–10, amarelo 7–8, vermelho 0–6);
  clicar abre a conversa. A nota vale qualquer jeito de responder ("10", "nota 9", "dez").
- Conta como **atendimento** cada vez que o cliente entra na fila (pelo bot) ou que um atendente
  começa a falar com alguém (Nova conversa, Puxar). Atendimentos de antes do Relatório existir
  foram montados pelas mensagens (aproximado: "assumiu" = 1ª resposta).

### Relatório > Auditoria
Os atendimentos **finalizados**, para conferir depois.
- **Filtros**: de/até (padrão: últimos 30 dias), protocolo (acha mesmo fora das datas), cliente
  (nome ou telefone), atendente, setor (só aparece com mais de um setor), motivo de encerramento
  (ou "Sem motivo"), como foi finalizado (pelo atendente, fechamento automático, outro), nota
  (com, sem, 0–6, 7–8, 9–10) e marcador (que a conversa tem agora). 50 por página.
- **Exportar lista (Excel)**: planilha (.csv) com os mesmos filtros: protocolo, cliente, telefone,
  atendente, setor, horários, tempos, motivo e nota (até 5.000 linhas).
- **Detalhe do atendimento** (clicar numa linha): cliente, atendente, setor, de onde começou, os
  horários (aberto, assumido, 1ª resposta, finalizado), os tempos, motivo e nota; a **conversa só
  daquele atendimento**, com notas internas em amarelo, fotos/áudios/vídeos e reações; e os outros
  atendimentos do mesmo cliente.
- **Imprimir ou salvar PDF**: abre uma folha limpa com o nome do negócio, os dados e a conversa e
  já chama a impressão (no Chrome, "Salvar como PDF").
- **Baixar em texto**: a conversa num arquivo .txt (cabeçalho do atendimento + uma linha por
  mensagem).

### Relatório > Reincidências
- Clientes que **voltaram a chamar até X dias** depois de um atendimento finalizado (X em
  Configurações > Metas; padrão 7). Muitas vezes é sinal de que o problema não foi resolvido.
- Mostra quando voltou, o cliente, depois de quanto tempo, o atendimento anterior (protocolo, quem
  atendeu e o motivo). Clicar abre o atendimento anterior na Auditoria.
- Filtro por período e por atendente (o atendente do atendimento **anterior**).
## Menu: Fila (a tela principal do atendente)
**Topo da Fila**
- **Pausar**: escolhe o motivo (Almoço, Lanche ou café, Banheiro, Reunião, Outro; editáveis em
  Configurações > Pausas e alertas). Em pausa aparece a faixa "Você está em pausa" com o botão
  **Voltar ao atendimento**; a faixa fica vermelha quando passa do limite do motivo. Em pausa a
  pessoa **não recebe conversa nova**: não conta como atendente disponível (o bot manda "sem
  atendente disponível" se ninguém mais estiver livre), ninguém consegue transferir pra ela, e o
  bloco "Transferir para atendente" do fluxo deixa a conversa na fila do setor. **Assumir** uma
  conversa ou **Sair** do sistema também encerra a pausa.
- **Suas conversas: X de Y**: aparece quando o atendente tem limite de conversas ao mesmo tempo
  (em Atendentes). No limite, ele não assume, não puxa do bot, não inicia conversa nova e ninguém
  transfere pra ele, até finalizar ou transferir uma.
- **Faixa de alertas** (amarela; em negrito vermelho os graves): cliente esperando na fila demais,
  fila cheia, atendente com cliente sem resposta, pausa que passou do limite (essa só para a
  gestão e para a própria pessoa). Quando um alerta aparece ou piora, quem está com o painel aberto
  ouve o bipe e recebe o aviso do Windows (de novo a cada 15 min se continuar).

- **Vários números**: com mais de um número ligado, cada conversa da lista mostra a etiqueta do número
  por onde chegou, o cabeçalho diz "Pelo número …", há o filtro **Número** (lembrado, como o setor)
  e a **+ Nova conversa** pergunta por qual número mandar.
- **Instagram**: as conversas do Direct entram na mesma lista, com a etiqueta do Instagram e o @ do
  cliente no lugar do telefone. A equipe responde com texto, foto, vídeo e PDF (a legenda vai logo
  depois, numa mensagem à parte), cita e reage; áudio gravado não vai. Passadas 24 h da última
  mensagem do cliente aparece a faixa "Passaram 24 horas" e não dá mais para responder até ele
  escrever de novo (regra do Instagram). A **+ Nova conversa** só sai por WhatsApp.
- **API oficial: regra das 24 horas.** Passadas 24 h da última mensagem do cliente, aparece a faixa
  "Passaram 24 horas" e só dá para mandar um **modelo aprovado** (escolhe o modelo, preenche as
  informações {{1}}, {{2}}... e **Mandar modelo**); o texto do modelo fica no histórico.

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
- **Marcador**: botão com ícone de etiqueta; filtra pelas conversas com aquele marcador (fica
  lembrado, como o setor).
- **Fixadas** (📌): as conversas que você fixou ficam no topo da sua lista (só na sua).
- **Cada conversa** mostra: 📌 se fixada, número · nome do cliente, marcadores coloridos, "há X min" (anda sozinho), última mensagem
  ("Você:" / "Bot:" quando não foi o cliente), setor e a **bolinha**.
- **Bolinha**: aparece só quando é a vez do atendente responder. Amarela/vermelha conforme o
  tempo que o cliente está esperando (tempos em Configurações > Fila de atendimento). Quem espera
  há mais tempo fica em cima.
- **No bot**: cada conversa tem o botão **Puxar**, que tira do bot e assume na hora.

**Conversa aberta (lado direito)**
- **Topo fixo**: número · nome do cliente, situação ("Atendendo: Fulano · Setor", "Na fila…",
  "Com o bot", "Finalizada") e os botões **Assumir** / **Puxar pra mim**, **Transferir**
  (outro setor e, se quiser, um atendente específico) e **Finalizar**.
- **Protocolo**: cada atendimento ganha um número (data + sequência, ex.: 202610180012), mostrado
  no topo da conversa. Pode ir na boas-vindas do atendente com `{{atendimento.protocolo}}`.
- **Ações ▾** (topo da conversa): **Ficha do contato** (quem tem a permissão de Contatos), **Fixar/Desfixar no topo da lista**, **Marcadores** (marca e
  desmarca, Salvar) e **Devolver ao bot** (fecha o atendimento sem mensagem de encerramento nem
  pesquisa, grava nota "Devolvida ao bot por Fulano" e o cliente recebe o menu inicial do fluxo).
- **Lápis ao lado do nome**: troca o nome do cliente, quantas vezes quiser. Em branco volta pro
  nome do perfil do WhatsApp.
- **Histórico**: só ele rola; abre já na última mensagem. Cliente em cinza, bot em azul-marinho,
  atendente em verde com o nome de quem respondeu. Mostra negrito/itálico/riscado como o WhatsApp,
  imagens, vídeos, áudios e link pra PDF.
- **Atendimentos separados por faixa**: cada atendimento do mesmo cliente começa com uma linha
  "Atendimento <protocolo> · data · setor · motivo" (ou "atual"), pra ver o que já aconteceu antes.
- **Responder citando e reagir**: embaixo de cada mensagem (cliente ou atendente) aparecem
  **↩ Responder** (a próxima resposta vai citando aquela mensagem, como no WhatsApp; a faixa
  "Respondendo a: …" com ✕ fica acima do campo) e **☺ Reagir** (👍 ❤️ 😂 😮 😢 🙏; o mesmo emoji de
  novo tira a reação). Quando o cliente cita ou reage, aparece também no histórico. Só nas mensagens
  que chegaram ou saíram depois desta versão (as antigas não têm o id do WhatsApp guardado).
- **Mensagem que falhou**: se o WhatsApp der erro ao enviar, a mensagem fica no histórico apagadinha
  com "⚠ Não foi enviada. Reenviar · Descartar" (não conta como resposta até sair de verdade).
- **Contato ignorado/bloqueado**: o topo da conversa mostra o aviso.
- **Notas internas** (fundo amarelo, "📝 Nota interna · Fulano"): só a equipe vê, o cliente não
  recebe. Não contam como resposta (a bolinha continua, o Relatório não mede). Toda transferência
  grava sozinha uma nota do sistema: "Transferida de X para Y, por Fulano".
- **Responder** (quando a conversa está com você): emoji, anexo (imagem, vídeo, áudio ou PDF),
  gravar áudio pelo microfone (com cronômetro e cancelar), **respostas rápidas** (botão do raio ou
  digitar `/` e o começo do nome; setas + Enter escolhem), chave **Nota interna** (o campo fica
  amarelo e o botão vira "Salvar nota"), texto e Enviar.
- **Escrever nota interna** (embaixo da conversa quando ela não está com você: na fila, no bot ou
  finalizada).
- **Finalizar**: pede o **motivo do encerramento** (lista em grupos, ex.: "Resolvido › Pedido
  feito"; obrigatório se ligado em Configurações), manda a mensagem de encerramento e, se configurada, a pesquisa de satisfação.
  A nota que o cliente mandar em até 30 min é agradecida e registrada.

**+ Nova conversa** (topo da página): chama um cliente que ainda não escreveu. Confere se o número
tem WhatsApp, já abre a conversa assumida por quem criou e manda a primeira mensagem (opcional).

**Avisos de mensagem nova**: bipe + aviso na tela + notificação do Windows (botão "🔔 Ativar
avisos na tela" na barra lateral). Com o painel aberto em várias abas, avisa uma vez só. Se você
estiver digitando (resposta, anexo ou áudio pendente, "+ Nova conversa" preenchida ou qualquer
campo em foco), mostra "Chegou mensagem nova. Atualizar" em vez de recarregar. O texto da resposta
fica guardado na aba: se a tela recarregar ou você trocar de conversa e voltar, ele continua lá.

## Menu: Contatos
(Administrador, ou atendente com a permissão "Ver e editar Contatos".)
- Todo número que já falou com a gente (os anonimizados pela retenção não aparecem). Cartões
  **Total, Normais, Ignorados, Bloqueados** (clicar filtra), busca por nome, telefone, e-mail ou
  CPF/CNPJ, filtro por tag, 50 por página.
- **Ficha**: nome, e-mail, CPF/CNPJ, endereço, observações (só a equipe vê); **situação**:
  *Normal*, *Ignorado* (o bot não responde e não abre atendimento, mas a mensagem fica guardada;
  ex.: família, fornecedor) ou *Bloqueado* (nada é guardado nem respondido); **consentimento**
  (LGPD: aceitou receber mensagens; guarda a data do aceite e do pedido para sair); **tags**.
  Link "Abrir a conversa".
- **+ Novo contato**: telefone com DDD (confere no WhatsApp se existe) e nome; abre a ficha.
- **Exportar (Excel)**: baixa os contatos da lista (com a busca e os filtros de agora) numa
  planilha: nome, telefone, e-mail, documento, endereço, observações, tags, situação,
  consentimento (e a data) e última mensagem.
- **Importar planilha**: planilha CSV com a coluna **Telefone** (com DDD) e, se quiser, Nome,
  E-mail, Documento/CPF/CNPJ, Endereço, Observações, Tags (separadas por vírgula) e Consentimento
  ("sim"). Até 2.000 linhas. **1º passo**: confere e mostra o que vai acontecer (novos, já existem,
  com problema: telefone inválido ou repetido), sem gravar. **2º passo**: Importar. Quem já existe é
  completado (só os campos vazios; marcando "Trocar os dados que já estão preenchidos", troca
  também); tags são somadas; ignorado/bloqueado nunca mudam. Novos só entram se o número tiver
  WhatsApp (confere um por um; precisa do WhatsApp conectado).
- **Lembrete de recompra deste cliente (dias)** na ficha: o prazo só dele (em branco = o padrão).
- **Tags**: criar, renomear, ver quantos contatos têm, tirar de todos, excluir. Tag é do cliente
  (segmentação, futuras campanhas); marcador é do atendimento.

## Menu: Campanhas
(Administrador, ou atendente com a permissão "Campanhas e lembretes".) No alto de todas as abas, a
**faixa da fila de envios**: funcionando (quantos saíram hoje do limite) ou parada (WhatsApp
desconectado, fora do horário, feriado ou limite do dia).

### Campanhas > Campanhas
- Lista com situação (rascunho, enviando, pausada, concluída, cancelada), para quantos, enviadas,
  lidas, responderam e saíram. **+ Nova campanha**:
  - **Mensagem** com `{{cliente.nome}}` e `{{negocio.nome}}` e o exemplo "como chega para a Maria".
    Se o texto não falar em SAIR, o sistema põe no fim "(Para não receber mais mensagens como esta,
    responda SAIR.)".
  - **Para quem**: tags (qualquer uma ou todas; nenhuma = todos), **só quem aceitou receber**
    (consentimento; vem marcado), e não mandar para quem recebeu outra campanha nos últimos N dias
    (padrão 7). Mostra quantos vão receber, quantos ficaram de fora por falta de consentimento e
    alguns nomes. Nunca recebem: ignorados, bloqueados, quem pediu para sair; quem estiver em
    atendimento na hora fica de fora.
  - **Frase-chave** (opcional, até 3 palavras, ex.: PROMO): quem responder com ela (até 7 dias, sem
    diferença de maiúscula/acento) vai para um atendente no setor escolhido, ou começa o bot num
    bloco do fluxo. Outra resposta segue o bot normal e fica marcada como "respondeu".
  - **Mandar teste** para um contato (na hora, fora da fila, não conta nos números).
  - **Começar** agora ou num dia e hora: todos do público entram na fila de envios e saem devagar,
    pelas Regras de envio.
- Depois de começar: números (enviadas, entregues, lidas e %, responderam, saíram, não mandadas),
  **Pausar / Retomar**, **Cancelar** (quem está na fila não recebe), **Fazer uma cópia**, e a lista
  dos clientes com a situação de cada um. O rascunho pode ser editado ou excluído.

- **API oficial**: a campanha ganha "Pela API oficial: modelo aprovado" (escolher o modelo e o que vai
  em cada {{n}}, com `{{cliente.nome}}` e `{{negocio.nome}}`). Cada cliente recebe o modelo com os dados
  dele. Sem modelo, quem estiver fora das 24 h fica de fora (em Envios, com o motivo).

### Campanhas > Lembretes de recompra
- X dias depois da última **compra**, o cliente recebe um aviso para pedir de novo. Compra = pedido
  salvo pelo bot (coleção "pedidos") ou atendimento finalizado com um dos **motivos marcados**
  (padrão: os que têm "Pedido" no nome, ex.: "Resolvido › Pedido feito").
- **Ligado/desligado** (vem desligado; confere de hora em hora), **dias** (3 a 365; padrão 30),
  **média do cliente** (com 3 compras ou mais, usa o tempo médio entre as compras dele), e o prazo
  de cada cliente pode ser mudado na ficha (Contatos). Só lembra até 30 dias depois do prazo
  (cliente sumido não recebe) e uma vez por compra.
- **Mensagem** com `{{cliente.nome}}`, `{{negocio.nome}}` e `{{dias}}`, com exemplo na tela.
- **Quando o cliente responder**: passa para um atendente (no setor escolhido, com nota "Respondeu
  ao lembrete") ou segue o bot.
- **API oficial**: escolher o modelo aprovado do lembrete (pode usar `{{cliente.nome}}`, `{{negocio.nome}}`
  e `{{dias}}` em cada {{n}}).
- Números dos últimos 30 dias (enviados, lidos, responderam, pediram para sair, na fila), lista de
  **quem está na hora agora** (com o motivo se não for receber) e **Pôr na fila agora**, e os
  últimos lembretes.

### Campanhas > Retornos agendados
- Os retornos marcados na conversa (**Ações ▾ › Agendar retorno**: dia, hora, para quem, motivo e,
  se quiser, uma mensagem para o cliente). Na hora, a conversa vai para a pessoa escolhida
  ("Atendendo"), entra a nota "📅 Retorno agendado…", ela recebe o aviso e a mensagem vai para o
  cliente. Se outra pessoa estiver atendendo, só entra a nota. Lista dos marcados (cancelar) e dos
  feitos. Na conversa aparece "📅 Retorno marcado para …" com **cancelar**.

### Campanhas > Envios
- Tudo o que o sistema manda sozinho: na fila, enviado, não mandado (com o motivo: bloqueado,
  ignorado, pediu para sair, em atendimento, modo de teste), falhou, cancelado; entregue, lido e
  respondeu. Filtro por situação; cancelar o que está na fila.

### Campanhas > Regras de envio
- Valem para lembretes e campanhas: **horário de envio** por dia (até 2 períodos; padrão seg a sáb,
  8h às 19h), **não mandar em feriado**, **intervalo** sorteado entre um envio e outro (padrão 45 a
  90 s) e **limite por dia** (padrão 100). Fora disso, fica na fila e sai depois. Aviso do risco de
  bloqueio do número no WhatsApp não oficial.
- **SAIR**: quem responde SAIR (ou PARAR, STOP, CANCELAR...) até 7 dias depois de um envio
  automático, sem estar em atendimento, para de receber lembretes e campanhas (o consentimento é
  tirado e a data guardada) e recebe uma confirmação.

## Menu: Respostas rápidas
(Administrador, ou atendente com a permissão "Cadastrar e editar Respostas rápidas".)
- Lista: nome (+ "inativa"/"vencida"), setores, texto, validade; Editar, **Duplicar**, Excluir.
- Formulário: nome (é o que o atendente procura com `/`), texto (até 4.000) com botões de
  **variáveis** — saudação (bom dia/boa tarde/boa noite), nome e telefone do cliente, nome do
  atendente, protocolo, setor, dados do negócio — e **prévia** com dados de exemplo; **setores**
  onde aparece (nenhum = todos); **validade** (depois do dia some da conversa); **Ativa**.
- Na conversa, as variáveis já vêm trocadas pelos dados daquela conversa.

## Menu: Atendentes
- Lista com nome, e-mail, papel, status (ativo/inativo; em pausa, com o motivo; o limite de
  conversas), último login e bolinha de online.
- Cadastrar / editar: nome, e-mail, senha, papel (admin ou atendente), **limite de conversas ao
  mesmo tempo** (0 = sem limite), setores e permissões.
- **Histórico de acessos**: quem entrou e saiu, senhas erradas, bloqueios por tentativas, por
  horário ou por IP, com IP e navegador; filtro por atendente; guarda 90 dias.
- No cadastro: **grupo de permissões** e **Quando e de onde pode entrar** (horário por dia, até 2
  períodos, e IPs liberados), só para o administrador mexer.
- Ativar / desativar com um clique (não apaga). O sistema não deixa remover o último admin ativo,
  e um atendente comum não consegue se promover a admin.

## Menu: Setores
- Criar e renomear setores (ex.: Geral, Vendas, Suporte). O setor "Geral" sempre existe (é pra
  onde o fluxo padrão transfere).
- **Horário do setor** (link na lista): por dia da semana, até 2 períodos (ex.: 8h às 12h e 14h às
  18h), com "copiar segunda para terça a sexta", e a **mensagem de fora do horário**. Quem cai na
  fila do setor fora do horário (ou num feriado) recebe essa mensagem no lugar do "sem atendente
  disponível"; a conversa continua na fila. Sem horário = sempre aberto.
- Os setores servem pra: separar a fila, definir quem vê o quê (atendente x setor) e pra onde o
  bot/inatividade transfere.

## Menu: Fluxo (editor visual do bot)
- Quadro com blocos ligados por setas; arrasta a bolinha de saída até a entrada de outro bloco
  pra conectar, clica na linha pra apagar. Botão **Salvar** grava o fluxo.
- Tipos de bloco: **Mensagem**, **Pergunta** (opções numeradas ou texto livre, pode guardar a
  resposta numa variável), **Condição**, **Horário** (dentro/fora do horário de funcionamento),
  **Transferir** (pra um setor), **Transferir para atendente** (já entra "atendendo" com a pessoa
  escolhida, setor opcional), **Aguardar resposta** (não manda nada, espera o cliente e segue; pode
  guardar a resposta numa variável), **Nota interna** (escreve uma nota no histórico, o cliente não
  recebe), **Salvar registro** (ex.: pedido), **Chamar API**, **Fim**.
- **Horário** num feriado sem expediente (Configurações > Feriados) vai pelo "fora", mandando antes
  a mensagem do feriado, se tiver.
- Variáveis nos textos: `{{negocio.nome}}`, `{{negocio.horario_funcionamento}}`,
  `{{negocio.endereco}}`, `{{negocio.formas_pagamento}}`, `{{negocio.numero_atendente_legivel}}`,
  `{{vars.X}}`. Se a variável estiver vazia, a linha inteira não é mandada.
- Palavras que reiniciam o bot (ex.: "menu", "oi") — mas **não** quando a conversa está com
  atendente.
- **▶ Testar** (simulador): abre uma conversa de teste ao lado do quadro; você escreve como o
  cliente e o bot responde pelo fluxo **que está na tela** (mesmo sem salvar). O bloco onde o
  fluxo parou fica com borda laranja. Não manda WhatsApp, **não grava** pedido/registro nem nota e
  **não chama API** (mostra em amarelo o que faria: "Salvaria um registro em pedidos…", "Chamaria a
  API…", "Nota interna…", "A conversa iria para a fila do setor…"; a API segue pelo caminho de
  sucesso). O bloco Horário usa a hora de agora. **Recomeçar** limpa a conversa de teste.
- **Mais ▾ > Fluxos prontos**: modelos para **revenda de gás, loja, clínica ou consultório,
  provedor de internet e delivery** (menu, pedido ou agendamento com confirmação, horário de
  atendimento, falar com atendente). Escolher um troca o fluxo **da tela** (só vale depois de
  Salvar); avisa se o modelo usa setores que não existem (o de provedor usa Suporte, Financeiro e
  Vendas).
- **Mais ▾ > Importar de arquivo**: carrega um fluxo salvo em arquivo (.json) na tela, depois de
  conferir se é válido; também só vale depois de Salvar.
- **Mais ▾ > Exportar**: baixa o fluxo **salvo** num arquivo (.json), para guardar ou levar para
  outra instalação.
- **Vários fluxos (um por número)**: com mais de um fluxo, o topo mostra qual está aberto (e quantos
  números usam cada um). **Mais ▾ > Fluxos**: lista, editar, renomear, excluir (o Principal e fluxo em
  uso por um número não) e **criar** um fluxo novo, começando de uma cópia, de um fluxo pronto ou em
  branco. Salvar, testar, exportar e as versões são de cada fluxo. Qual número usa qual fluxo se
  escolhe em Configurações > WhatsApp. Se o cliente passa a escrever por um número com outro fluxo,
  ele começa no bot desse número (o histórico continua um só).
- **Mais ▾ > Versões salvas**: cada Salvar guarda a versão (as últimas 100), com quando, quem e de
  onde veio (editor, fluxo pronto, arquivo, volta de versão). **Voltar para esta versão** passa a
  valer na hora para o bot (e o fluxo de antes também fica guardado). **Baixar** cada versão.

## Menu: Configurações
- **Cartões no topo**: WhatsApp (conectado ou não), Motivos de encerramento, Marcadores, Feriados
  (com quantos ativos) e Metas (quantas definidas), e atalhos para cada quadro. Botão **Salvar alterações** fixo no pé da tela,
  com aviso de alteração não salva.
- **Dados do negócio**: nome, horário, endereço, formas de pagamento.
- **Mensagens automáticas**: boas-vindas do atendente (ao assumir), encerramento (ao finalizar),
  pesquisa de satisfação, avaliação não respondida (30 min depois da pesquisa), sem atendente
  disponível (ninguém do setor online). Em branco = não manda.
- **Fila de atendimento**: minutos pra bolinha ficar amarela e vermelha.
- **Cliente parado no meio do bot**: minutos até o lembrete + texto do lembrete; minutos até
  desistir; ao desistir, **reiniciar o fluxo** (em silêncio) ou **transferir pra um atendente**
  (setor e mensagem pro cliente).
- **Ao finalizar a conversa**: "Exigir motivo ao finalizar", mensagem de encerramento, pesquisa de
  satisfação e lembrete se o cliente não avaliar.
- **Marcadores** (cartão no topo de Configurações; salvar tudo num botão só): nome, cor, ativo, quantas conversas usam;
  criar, editar e excluir (sai de todas as conversas). Vem com Urgente, Aguardando retorno,
  Reclamação, Cliente novo e VIP. O marcador fica no cliente até alguém tirar.
- **Motivos de encerramento** (cartão no topo de Configurações; salvar tudo num botão só): grupos (Resolvido, Não resolvido,
  Sem contato...) com motivos dentro; criar, renomear, desativar (some do Finalizar sem apagar o
  histórico) e excluir. Vem com uma lista inicial pra revenda de gás. O motivo escolhido fica
  guardado no atendimento.
- **Fechamento automático**: fecha o atendimento aberto há mais de N horas (padrão 24; 0 = nunca),
  contando desde a abertura, com mensagem opcional.

### Configurações > Feriados
- **Importar feriados nacionais**: os de data fixa (todo ano) e Carnaval, Sexta-feira Santa e
  Corpus Christi deste ano e do próximo (Carnaval e Corpus Christi entram como "abre normal", ponto
  facultativo). Não repete os que já existem.
- Cada feriado: nome, data, repete todo ano, dia inteiro ou período, **tem expediente** (só
  registra), mensagem do feriado, ativo. Lista na ordem do próximo a acontecer.
- Num feriado sem expediente: o bloco Horário do fluxo vai pelo "fora" e os setores ficam fechados.

### Configurações > Metas
- Minutos de **espera na fila**, **1ª resposta** e **duração do atendimento**, e a **nota média
  mínima** (0 a 10, aceita 8,5). 0 = sem meta naquele item. O Relatório compara com elas.
- **Reincidência**: quantos dias depois de finalizar a volta do cliente conta como reincidência
  (1 a 90; padrão 7).

### Configurações > Status do sistema
- Verde/amarelo/vermelho para: **WhatsApp** (conectado ou não), **Banco de dados** (checagem e
  tamanho), **Espaço em disco** (amarelo abaixo de 15% livre, vermelho abaixo de 5%), **Backup**
  (o último e há quanto tempo; amarelo se tiver mais de 2 dias) e **Sistema** (ligado há quanto
  tempo, versão, memória). O cartão em Configurações mostra o resumo ("Tudo certo", "1 problema").

### Configurações > Pausas e alertas
- **Motivos de pausa**: nome, limite em minutos (0 = sem limite), ativo; adicionar e excluir (as
  pausas já feitas continuam no Relatório). Sem nenhum motivo ativo, o botão Pausar some.
- **Alertas de fila** (0 desliga cada um): cliente esperando na fila há mais de X min; fila com N
  clientes ou mais; atendente com cliente sem resposta há mais de X min. Vêm desligados.

### Configurações > Painel da TV
- **Ligar e gerar o link**: cria um link secreto (`/tv/<código>`) que abre **sem senha** uma tela
  grande para deixar numa TV: clientes esperando, maior espera, em atendimento, com o bot, a equipe
  (livre, atendendo, no limite, em pausa, offline), a fila por setor, os alertas e os números de
  hoje. Atualiza sozinha a cada 15 s e avisa se perdeu a conexão. **Não mostra mensagens, nomes
  nem telefones de clientes.**
- **Gerar novo link** troca o código (o antigo para de funcionar na hora). **Desligar** apaga.

### Configurações > WhatsApp
- **Como o WhatsApp está ligado**: **WhatsApp do celular (QR Code)** ou **API oficial da Meta**. A
  escolha vale depois de reiniciar o sistema (a tela mostra a em uso e avisa quando falta reiniciar).
- **Números** (pelo celular): cada número é um WhatsApp ligado pelo QR Code, com o estado e o QR
  dele, **nome** (ex.: Suporte 1, Suporte 2) e o **fluxo do bot** que usa (pode ser o mesmo para
  todos). **+ Adicionar número** (liga na hora e mostra o QR para ler no celular desse número),
  **Desligar/Ligar** (o último ligado não desliga; o histórico fica). Todas as conversas caem na mesma
  Fila e a resposta sai pelo número por onde o cliente escreveu por último.
- **API oficial da Meta**: código do número (Phone number ID), código da conta (WhatsApp Business
  Account ID), chave de acesso permanente e segredo do app (os dois só aparecem com o final
  ••••), versão da API. **Salvar e conferir com a Meta** mostra o número, o nome verificado e a
  qualidade (ou o erro em português). **Webhook**: a URL de retorno e o token de verificação para
  colar na Meta (dá para trocar o token). **Modelos aprovados**: **Atualizar modelos da Meta** puxa
  os modelos (nome, idioma, tipo, situação e texto).
- Passo a passo da Meta: `passo_a_passo_meta_E4.md` (pasta do ChatDigital no OneDrive).

### Configurações > Instagram
- Liga o **Direct** do Instagram da empresa (uma conta por instalação; conta profissional, sem página
  do Facebook).
- **Conectar pelo app do ChatDigital** (o normal): um app só na Meta para todas as instalações, com a
  **central do Instagram** no meio. Quem instala preenche uma vez os **dados da central** (endereço,
  código desta instalação e segredo combinado); depois a empresa só clica em **Entrar com Instagram**,
  entra com o Instagram dela, aceita as permissões e volta conectada. **Desconectar o Instagram** tira
  a conta (os dados da central ficam).
- **Usar um app próprio da empresa na Meta (avançado)**, fechado por padrão. **Dados da conta**: código da conta (Instagram account ID), chave de acesso e segredo
  do app (só aparecem com o final ••••), **endereço do sistema** (https; por ele o Instagram busca as
  fotos, vídeos e PDFs) e versão da API. **Salvar e conferir com o Instagram** mostra o @ da conta (ou
  o erro em português). A chave vale 60 dias e o sistema **renova sozinho** depois de 30.
- **Webhook**: URL de retorno (`/webhook/instagram`) e token de verificação para colar na Meta (dá para
  trocar o token).
- **Na Fila e no bot**: nome da etiqueta na Fila, **fluxo do bot** do Instagram e **Desligar/Ligar**
  (desligado, as mensagens do Direct não entram; o histórico fica). O cartão em Configurações mostra o
  @ da conta, "Com problema", "Desligado" ou "Não configurado".
- Lembretes e campanhas só vão para contato do Instagram que escreveu nas últimas 24 h (os outros
  ficam como pulados, com o motivo).
- Passo a passo da Meta: `passo_a_passo_instagram.md` (pasta do ChatDigital no OneDrive).

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
- **Fila de envios automáticos**: a cada 10 s manda no máximo um lembrete/campanha, dentro das regras de envio.
- **Lembrete de recompra**: de hora em hora põe na fila quem venceu (se estiver ligado).
- **Retornos agendados**: a cada minuto faz os que chegaram na hora.
- **Alertas de fila**: confere a cada minuto e avisa quem está com o painel aberto — ver Configurações > Pausas e alertas.
- **Depois de reiniciar o servidor**: quem estava com atendente continua com atendente (o bot não
  volta a falar).
- **Backup do banco** 1 vez por dia, guardando os últimos 30 dias.
- **Retenção (LGPD)**: conversa sem atividade há 12 meses tem as mensagens apagadas, o número
  anonimizado e a ficha do contato (nome, e-mail, documento, endereço, observações, tags) apagada
  (os números da estatística continuam).
- **Modo de teste** (só em teste, com `NUMEROS_TESTE`): o bot e as mensagens automáticas só
  falam com os números da lista.
