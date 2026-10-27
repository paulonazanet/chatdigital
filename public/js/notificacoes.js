(function () {
  var ctxAudio = null;

  // Som dos avisos: o que a empresa escolheu (Configurações > Pausas e alertas, vem do servidor) e
  // o "🔕" de cada atendente, que vale só neste computador (guardado no navegador).
  var SOM = window.CHATDIGITAL_SOM || { mensagem: true, alertas: true, volume: 'medio' };
  var VOLUMES = { baixo: 0.25, medio: 0.5, alto: 0.9 };
  var CHAVE_MUDO = 'chatdigital-som-mudo';
  function estaMudo() {
    try { return localStorage.getItem(CHAVE_MUDO) === '1'; } catch (e) { return false; }
  }
  function algumSomLigado() {
    return (SOM.mensagem || SOM.alertas) && !estaMudo();
  }

  // O navegador só deixa tocar som depois de um clique (ou tecla) na página. A cada clique tenta
  // liberar de novo; enquanto estiver bloqueado, aparece o aviso "🔇 Clique para ligar o som".
  function garantirContextoAudio() {
    if (!ctxAudio) {
      try {
        ctxAudio = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {}
    }
    if (ctxAudio && ctxAudio.state === 'suspended') {
      ctxAudio.resume().then(atualizarAvisoSomBloqueado, function () {});
    }
    atualizarAvisoSomBloqueado();
  }

  function atualizarAvisoSomBloqueado() {
    var aviso = document.getElementById('aviso-som-bloqueado');
    var bloqueado = algumSomLigado() && (!ctxAudio || ctxAudio.state !== 'running');
    if (!bloqueado) {
      if (aviso) aviso.remove();
      return;
    }
    if (aviso) return;
    var sair = document.querySelector('.barra-lateral .sair');
    if (!sair) return;
    aviso = document.createElement('button');
    aviso.type = 'button';
    aviso.id = 'aviso-som-bloqueado';
    aviso.className = 'aviso-som-bloqueado';
    aviso.textContent = '🔇 Clique para ligar o som dos avisos';
    aviso.addEventListener('click', function () {
      garantirContextoAudio();
      tocarBipe('mensagem', true);
    });
    sair.parentNode.insertBefore(aviso, sair);
  }

  // Um "dim-dom" (dois tons) pra mensagem nova; nos alertas, um tom mais agudo, 3 vezes seguidas
  function tocarTom(frequencia, inicio, duracao, volume) {
    var osc = ctxAudio.createOscillator();
    var ganho = ctxAudio.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequencia;
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.exponentialRampToValueAtTime(volume, inicio + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
    osc.connect(ganho);
    ganho.connect(ctxAudio.destination);
    osc.start(inicio);
    osc.stop(inicio + duracao);
  }
  // tipo: 'mensagem' ou 'alerta'; teste = true toca mesmo com o som desligado (botão "Ouvir")
  function tocarBipe(tipo, teste) {
    tipo = tipo === 'alerta' ? 'alerta' : 'mensagem';
    if (!teste && (estaMudo() || !(tipo === 'alerta' ? SOM.alertas : SOM.mensagem))) return;
    if (!ctxAudio || ctxAudio.state !== 'running') return;
    try {
      var volume = VOLUMES[SOM.volume] || VOLUMES.medio;
      var agora = ctxAudio.currentTime + 0.01;
      if (tipo === 'alerta') {
        for (var i = 0; i < 3; i++) {
          tocarTom(1175, agora + i * 0.6, 0.22, volume);
          tocarTom(880, agora + i * 0.6 + 0.22, 0.3, volume);
        }
      } else {
        tocarTom(988, agora, 0.25, volume);
        tocarTom(740, agora + 0.25, 0.45, volume);
      }
    } catch (e) {}
  }

  // Botão 🔔/🔕 no menu: desliga o som só neste computador
  function configurarBotaoMudo() {
    var sair = document.querySelector('.barra-lateral .sair');
    if (!sair || document.getElementById('botao-som-mudo') || !(SOM.mensagem || SOM.alertas)) return;
    var botao = document.createElement('button');
    botao.type = 'button';
    botao.id = 'botao-som-mudo';
    botao.className = 'botao-som-mudo';
    function desenhar() {
      var mudo = estaMudo();
      botao.innerHTML = '<span aria-hidden="true">' + (mudo ? '🔕' : '🔔') + '</span> <span class="recolhivel">' + (mudo ? 'Som desligado' : 'Som ligado') + '</span>';
      botao.title = mudo ? 'Ligar o som dos avisos neste computador' : 'Desligar o som dos avisos neste computador';
      botao.setAttribute('aria-pressed', mudo ? 'true' : 'false');
    }
    botao.addEventListener('click', function () {
      try { localStorage.setItem(CHAVE_MUDO, estaMudo() ? '0' : '1'); } catch (e) {}
      desenhar();
      garantirContextoAudio();
      if (!estaMudo()) tocarBipe('mensagem');
    });
    desenhar();
    sair.parentNode.insertBefore(botao, sair);
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

  // Qualquer coisa que o atendente perderia com um recarregamento: texto da resposta, anexo ou
  // áudio gravado/gravando, a "+ Nova conversa" preenchida, ou um campo em foco (renomear,
  // transferir...). Antes olhava só o 1º textarea da página — que é o da "+ Nova conversa", quase
  // sempre vazio — e a tela recarregava apagando a resposta que o Carlos estava digitando.
  function temRascunhoDeResposta() {
    var resposta = document.querySelector('.form-responder textarea[name="texto"]');
    if (resposta && resposta.value.trim().length > 0) return true;
    var anexo = document.querySelector('.form-responder input[type="file"]');
    if (anexo && anexo.files && anexo.files.length > 0) return true;
    if (document.querySelector('.botao-gravar-audio.gravando')) return true;
    var citar = document.querySelector('.form-responder input[name="citar_id"]');
    if (citar && citar.value) return true;
    if (document.querySelector('.reagir-popover[open]')) return true;
    var novaConversa = document.querySelectorAll('.nova-conversa-popover input, .nova-conversa-popover textarea');
    for (var i = 0; i < novaConversa.length; i++) {
      if (novaConversa[i].value.trim().length > 0) return true;
    }
    var emFoco = document.activeElement;
    return !!emFoco && /^(TEXTAREA|INPUT|SELECT)$/.test(emFoco.tagName) && emFoco.type !== 'search';
  }

  function mostrarBannerAtualizar() {
    if (document.querySelector('.banner-atualizar')) return;
    var areaPrincipal = document.querySelector('.area-principal');
    if (!areaPrincipal) return;

    var banner = document.createElement('div');
    banner.className = 'banner-atualizar';
    banner.textContent = 'Chegou mensagem nova. ';

    var link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Atualizar';
    link.addEventListener('click', function (ev) {
      ev.preventDefault();
      atualizarFila();
    });
    banner.appendChild(link);

    areaPrincipal.insertBefore(banner, areaPrincipal.firstChild);
  }

  // Navegadores só liberam som/notificação depois de uma interação do usuário na página —
  // qualquer clique já destrava o som, mas a notificação do sistema (a que aparece mesmo com a
  // aba minimizada) só é pedida de verdade por um botão explícito, senão a permissão pode nunca
  // ser concedida de fato (o navegador só pergunta uma vez).
  document.addEventListener('click', garantirContextoAudio);
  document.addEventListener('keydown', garantirContextoAudio);
  // tenta já ao abrir: se o navegador deixar (o atendente usa o site todo dia), nem pede clique
  garantirContextoAudio();
  configurarBotaoMudo();
  document.addEventListener('click', function (ev) {
    var botao = ev.target.closest('[data-testar-som]');
    if (botao) setTimeout(function () { tocarBipe(botao.getAttribute('data-testar-som'), true); }, 50);
  });

  // Atualiza a Fila sem recarregar a página: busca a página de novo por trás e troca só o conteúdo.
  // Assim o som liberado por um clique continua valendo (recarregar bloqueava de novo até outro
  // clique). Os scripts da Fila rodam de novo no conteúdo novo; se algo falhar, recarrega.
  var atualizandoFila = false;
  function atualizarFila() {
    var atual = document.querySelector('main.conteudo-fila');
    if (!atual || !window.fetch || !window.DOMParser || atualizandoFila) return window.location.reload();
    atualizandoFila = true;
    var historico = atual.querySelector('.fila-detalhe .historico');
    var noFim = !historico || historico.scrollHeight - historico.scrollTop - historico.clientHeight < 40;
    var rolagemHistorico = historico ? historico.scrollTop : 0;
    var lista = atual.querySelector('.fila-lista');
    var rolagemLista = lista ? lista.scrollTop : 0;
    fetch(window.location.href, { credentials: 'same-origin' })
      .then(function (resposta) {
        if (!resposta.ok || resposta.url.indexOf('/painel/fila') === -1) throw new Error('fila');
        return resposta.text();
      })
      .then(function (html) {
        var pagina = new DOMParser().parseFromString(html, 'text/html');
        var novo = pagina.querySelector('main.conteudo-fila');
        if (!novo) throw new Error('fila');
        var banner = document.querySelector('.banner-atualizar');
        if (banner) banner.remove();
        atual.replaceWith(novo);
        // scripts que vêm dentro do conteúdo novo (DOMParser não roda) e os da Fila de novo
        novo.querySelectorAll('script').forEach(function (velho) {
          var script = document.createElement('script');
          for (var i = 0; i < velho.attributes.length; i++) script.setAttribute(velho.attributes[i].name, velho.attributes[i].value);
          script.textContent = velho.textContent;
          velho.replaceWith(script);
        });
        ['/js/fila-responder.js', '/js/fila-lista.js', '/js/respostas-rapidas.js'].forEach(function (src) {
          if (!document.querySelector('script[src="' + src + '"]')) return;
          var script = document.createElement('script');
          script.src = src;
          document.body.appendChild(script);
          script.onload = function () { script.remove(); };
        });
        var novoHistorico = novo.querySelector('.fila-detalhe .historico');
        if (novoHistorico) novoHistorico.scrollTop = noFim ? novoHistorico.scrollHeight : rolagemHistorico;
        var novaLista = novo.querySelector('.fila-lista');
        if (novaLista) novaLista.scrollTop = rolagemLista;
        if (pagina.title) document.title = pagina.title;
        atualizandoFila = false;
      })
      .catch(function () {
        window.location.reload();
      });
  }
  window.ChatDigitalAtualizarFila = atualizarFila;

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

  // Alerta de fila (cliente esperando demais, fila cheia, sem resposta, pausa longa): avisa com bipe e
  // aviso do Windows, mas não recarrega a tela (a faixa de alertas aparece no próximo recarregamento).
  origem.addEventListener('alerta', function (evento) {
    var dados = {};
    try {
      dados = JSON.parse(evento.data);
    } catch (e) {}
    if (!dados.texto) return;
    mostrarAvisoFlutuante('⚠️ ' + dados.texto);
    avisarUmaVezEntreAbas(dados.id, function () {
      tocarBipe('alerta');
      if ('Notification' in window && Notification.permission === 'granted') {
        var notificacao = new Notification('ChatDigital: alerta', { body: dados.texto, tag: 'chatdigital-' + dados.id });
        notificacao.onclick = function () {
          window.focus();
          notificacao.close();
        };
      }
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
      tocarBipe('mensagem');
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

    // Só avisa em vez de recarregar sozinho quando tem algo sendo digitado — recarregar nesse caso
    // perderia o rascunho. Sem rascunho, atualiza automaticamente (e a lista toda já vem fresca).
    // Confere de novo na hora de recarregar: o atendente pode ter começado a digitar nesse 1,5 s.
    if (temRascunhoDeResposta()) {
      mostrarBannerAtualizar();
    } else {
      setTimeout(function () {
        if (temRascunhoDeResposta()) mostrarBannerAtualizar();
        else atualizarFila();
      }, 1500);
    }
  });
})();
