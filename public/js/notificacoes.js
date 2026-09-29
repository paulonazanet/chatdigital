(function () {
  var ctxAudio = null;

  function garantirContextoAudio() {
    if (!ctxAudio) {
      try {
        ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    } else if (ctxAudio.state === 'suspended') {
      ctxAudio.resume();
    }
  }

  function tocarBipe() {
    if (!ctxAudio) return;
    try {
      var osc = ctxAudio.createOscillator();
      var ganho = ctxAudio.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      ganho.gain.setValueAtTime(0.15, ctxAudio.currentTime);
      ganho.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + 0.35);
      osc.connect(ganho);
      ganho.connect(ctxAudio.destination);
      osc.start();
      osc.stop(ctxAudio.currentTime + 0.35);
    } catch (e) {}
  }

  function mostrarAvisoFlutuante(texto) {
    var aviso = document.createElement('div');
    aviso.className = 'aviso-flutuante';
    aviso.textContent = texto;
    document.body.appendChild(aviso);
    setTimeout(function () {
      aviso.remove();
    }, 6000);
  }

  function estaNaFila() {
    return window.location.pathname.indexOf('/painel/fila') === 0;
  }

  function temConversaAberta() {
    return !!document.querySelector('main[data-conversa-numero]');
  }

  function temRascunhoDeResposta() {
    var campo = document.querySelector('textarea[name="texto"]');
    return !!campo && campo.value.trim().length > 0;
  }

  // Marca com uma bolinha piscando o cabeçalho de um setor que está recolhido e recebeu
  // novidade — sem abrir ele sozinho (isso desfaria o que o atendente organizou na mão). Some
  // sozinha quando o atendente abre o setor.
  function marcarNovidadeNoSetor(setorId) {
    var chave = setorId != null ? String(setorId) : 'sem-setor';
    var grupo = document.querySelector('.grupo-setor[data-setor-chave="' + chave + '"]');
    if (!grupo || grupo.open) return;

    var resumo = grupo.querySelector('summary');
    if (!resumo || resumo.querySelector('.ponto-novidade')) return;

    var ponto = document.createElement('span');
    ponto.className = 'ponto-novidade';
    resumo.appendChild(ponto);

    grupo.addEventListener(
      'toggle',
      function () {
        if (grupo.open && ponto.parentNode) ponto.remove();
      },
      { once: true },
    );
  }

  function mostrarBannerAtualizar() {
    if (document.querySelector('.banner-atualizar')) return;
    var areaPrincipal = document.querySelector('.area-principal');
    if (!areaPrincipal) return;

    var banner = document.createElement('div');
    banner.className = 'banner-atualizar';
    banner.textContent = 'Chegou mensagem nova nesta conversa. ';

    var link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Atualizar';
    link.addEventListener('click', function (ev) {
      ev.preventDefault();
      window.location.reload();
    });
    banner.appendChild(link);

    areaPrincipal.insertBefore(banner, areaPrincipal.firstChild);
  }

  // Navegadores só liberam som/notificação depois de uma interação do usuário na página —
  // qualquer clique já destrava o som, mas a notificação do sistema (a que aparece mesmo com a
  // aba minimizada) só é pedida de verdade por um botão explícito, senão a permissão pode nunca
  // ser concedida de fato (o navegador só pergunta uma vez).
  document.addEventListener('click', garantirContextoAudio, { once: true });

  function configurarBotaoAtivarNotificacoes() {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    var marca = document.querySelector('.barra-lateral .marca');
    if (!marca || document.getElementById('botao-ativar-notificacoes')) return;

    var botao = document.createElement('button');
    botao.id = 'botao-ativar-notificacoes';
    botao.type = 'button';
    botao.className = 'botao-ativar-notificacoes';
    botao.textContent = '🔔 Ativar avisos na tela';
    botao.title = 'Recebe um aviso do sistema (perto do relógio) mesmo com o ChatDigital minimizado';
    botao.addEventListener('click', function () {
      garantirContextoAudio();
      Notification.requestPermission().then(function () {
        botao.remove();
      });
    });
    marca.insertAdjacentElement('afterend', botao);
  }

  configurarBotaoAtivarNotificacoes(); // seguro chamar direto: o script tem "defer", o DOM já está pronto

  // Com o painel aberto em mais de uma aba, todas recebem o mesmo evento — sem isso cada aba
  // tocava o bipe e criava sua notificação do Windows (aviso em dobro). Só uma aba "ganha" a
  // trava com o id do evento; a aba em foco tenta primeiro, e depois a que já teve clique (o
  // bipe só toca em aba onde o atendente já clicou alguma vez).
  function avisarUmaVezEntreAbas(id, avisar) {
    if (id == null || !navigator.locks) return avisar();
    var espera = document.hasFocus() ? 0 : ctxAudio ? 300 : 600;
    setTimeout(function () {
      navigator.locks.request('chatdigital-aviso-' + id, { ifAvailable: true }, function (trava) {
        if (!trava) return; // outra aba já avisou
        avisar();
        // segura a trava um tempo, pra aba que chegar atrasada não avisar de novo
        return new Promise(function (resolve) {
          setTimeout(resolve, 10000);
        });
      });
    }, espera);
  }

  if (!('EventSource' in window)) return;

  var origem = new EventSource('/painel/eventos');

  origem.addEventListener('presenca', function (evento) {
    var dados = {};
    try {
      dados = JSON.parse(evento.data);
    } catch (e) {}
    var online = dados.online || [];
    document.querySelectorAll('[data-atendente-id]').forEach(function (linha) {
      var id = Number(linha.getAttribute('data-atendente-id'));
      var ponto = linha.querySelector('.ponto-online');
      if (!ponto) return;
      ponto.classList.toggle('online', online.indexOf(id) !== -1);
      ponto.title = online.indexOf(id) !== -1 ? 'Online agora' : 'Offline';
    });
  });

  origem.addEventListener('atencao', function (evento) {
    var dados = {};
    try {
      dados = JSON.parse(evento.data);
    } catch (e) {}

    // Número legível: o de exibição (guardado quando a conversa é em @lid, que não traz o
    // telefone no endereço) ou, na falta dele, o próprio número sem o sufixo técnico — mesma
    // regra usada na lista da Fila (fila/lista.ejs, exibirNumero).
    var numero = dados.numeroExibicao || (dados.numero ? dados.numero.replace('@s.whatsapp.net', '').replace('@lid', '') : '');
    var textos = {
      'novo-atendimento': 'Nova conversa aguardando atendimento',
      transferencia: 'Uma conversa foi transferida',
    };
    var texto = textos[dados.motivo] || 'Nova mensagem do cliente';
    if (numero) texto += ' — ' + numero;

    mostrarAvisoFlutuante(texto);
    avisarUmaVezEntreAbas(dados.id, function () {
      tocarBipe();
      if ('Notification' in window && Notification.permission === 'granted') {
        // requireInteraction: fica na tela até o atendente clicar ou fechar, em vez de sumir
        // sozinha em poucos segundos — importante justamente pra quem está noutro programa.
        // tag: se mesmo assim duas abas criarem, o Windows troca uma pela outra em vez de empilhar.
        var notificacao = new Notification('ChatDigital', { body: texto, requireInteraction: true, tag: 'chatdigital-' + dados.id });
        notificacao.onclick = function () {
          window.focus();
          notificacao.close();
        };
      }
    });

    if (!estaNaFila()) return;

    if (temConversaAberta() && temRascunhoDeResposta()) {
      // Só avisa em vez de recarregar sozinho quando tem uma resposta sendo digitada — recarregar
      // nesse caso perderia o rascunho. Sem rascunho, atualiza automaticamente (e nesse caso a
      // bolinha nem faz sentido, a lista toda já vem fresca do recarregamento).
      marcarNovidadeNoSetor(dados.setorId);
      mostrarBannerAtualizar();
    } else {
      setTimeout(function () {
        window.location.reload();
      }, 1500);
    }
  });
})();
