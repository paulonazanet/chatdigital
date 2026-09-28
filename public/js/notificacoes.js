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

  // Navegadores só liberam som/notificação depois de uma interação do usuário na página.
  document.addEventListener(
    'click',
    function () {
      garantirContextoAudio();
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    },
    { once: true },
  );

  if (!('EventSource' in window)) return;

  var origem = new EventSource('/painel/eventos');

  origem.addEventListener('atencao', function (evento) {
    var dados = {};
    try {
      dados = JSON.parse(evento.data);
    } catch (e) {}

    var numero = dados.numero ? dados.numero.replace('@s.whatsapp.net', '') : '';
    var texto = dados.motivo === 'novo-atendimento' ? 'Nova conversa aguardando atendimento' : 'Nova mensagem do cliente';
    if (numero) texto += ' — ' + numero;

    tocarBipe();
    mostrarAvisoFlutuante(texto);

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('ChatDigital', { body: texto });
    }
  });
})();
