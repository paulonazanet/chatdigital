(function () {
  var EMOJIS = [
    '😀', '😄', '🙂', '😉', '😍', '🥳', '😴', '🤔',
    '😢', '😡', '👍', '👎', '🙏', '👏', '🙌', '💪',
    '✅', '❌', '⏰', '📦', '🚚', '💳', '💰', '📍',
    '📞', '💬', '⭐', '🔥', '🎉', '❤️', '😊', '😅',
  ];

  var form = document.querySelector('.form-responder');
  if (!form) return;

  var botaoEmoji = form.querySelector('.botao-emoji');
  var painelEmoji = form.querySelector('.emoji-painel');
  var textarea = form.querySelector('textarea[name="texto"]');
  var inputArquivo = form.querySelector('input[type="file"]');
  var nomeAnexo = form.querySelector('.anexo-nome');

  if (botaoEmoji && painelEmoji && textarea) {
    if (painelEmoji.children.length === 0) {
      EMOJIS.forEach(function (emoji) {
        var botao = document.createElement('button');
        botao.type = 'button';
        botao.textContent = emoji;
        botao.addEventListener('click', function () {
          var inicio = textarea.selectionStart || textarea.value.length;
          var fim = textarea.selectionEnd || textarea.value.length;
          textarea.value = textarea.value.slice(0, inicio) + emoji + textarea.value.slice(fim);
          textarea.focus();
          textarea.selectionStart = textarea.selectionEnd = inicio + emoji.length;
        });
        painelEmoji.appendChild(botao);
      });
    }

    botaoEmoji.addEventListener('click', function () {
      painelEmoji.hidden = !painelEmoji.hidden;
    });

    document.addEventListener('click', function (ev) {
      if (!painelEmoji.hidden && !painelEmoji.contains(ev.target) && ev.target !== botaoEmoji) {
        painelEmoji.hidden = true;
      }
    });
  }

  var botaoRemover = form.querySelector('.botao-remover-anexo');

  function limparAnexo() {
    inputArquivo.value = '';
    nomeAnexo.textContent = '';
    nomeAnexo.classList.remove('gravando-texto');
    if (botaoRemover) botaoRemover.hidden = true;
  }

  if (inputArquivo && nomeAnexo) {
    inputArquivo.addEventListener('change', function () {
      var arquivo = inputArquivo.files[0];
      nomeAnexo.textContent = arquivo ? arquivo.name : '';
      if (botaoRemover) botaoRemover.hidden = !arquivo;
    });
  }

  // Gravar áudio direto do microfone (sem precisar salvar um arquivo antes) — usa a API nativa
  // do navegador (MediaRecorder), sem lib nova. O áudio gravado vira o mesmo arquivo anexado do
  // campo de upload, então o resto (envio, mostrar nome) funciona igual a anexar um arquivo.
  var botaoGravar = form.querySelector('.botao-gravar-audio');
  if (botaoGravar && inputArquivo && nomeAnexo && navigator.mediaDevices && window.MediaRecorder) {
    var gravador = null;
    var pedacos = [];
    var inicioGravacao = null;
    var cronometro = null;
    var cancelando = false;

    function tipoSuportado() {
      var candidatos = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
      for (var i = 0; i < candidatos.length; i++) {
        if (MediaRecorder.isTypeSupported(candidatos[i])) return candidatos[i];
      }
      return '';
    }

    function formatarTempo(ms) {
      var seg = Math.floor(ms / 1000);
      var mm = Math.floor(seg / 60);
      var ss = String(seg % 60).padStart(2, '0');
      return mm + ':' + ss;
    }

    function pararCronometro() {
      if (cronometro) {
        clearInterval(cronometro);
        cronometro = null;
      }
    }

    // Botão "✕" muda de função dependendo do estado: durante a gravação, cancela sem salvar
    // nada; depois de gravado (ou de anexar um arquivo comum), só remove o anexo.
    function atualizarBotaoRemover(gravando) {
      if (!botaoRemover) return;
      botaoRemover.hidden = false;
      botaoRemover.title = gravando ? 'Cancelar gravação' : 'Remover anexo';
    }

    botaoGravar.addEventListener('click', function () {
      if (gravador && gravador.state === 'recording') {
        gravador.stop(); // mantém o que foi gravado
        return;
      }

      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var mimeType = tipoSuportado();
        gravador = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
        pedacos = [];
        cancelando = false;
        inicioGravacao = Date.now();

        gravador.addEventListener('dataavailable', function (ev) {
          if (ev.data && ev.data.size > 0) pedacos.push(ev.data);
        });

        gravador.addEventListener('stop', function () {
          stream.getTracks().forEach(function (faixa) { faixa.stop(); });
          botaoGravar.classList.remove('gravando');
          pararCronometro();
          nomeAnexo.classList.remove('gravando-texto');

          if (cancelando || pedacos.length === 0) {
            limparAnexo();
            return;
          }

          var duracao = Math.round((Date.now() - inicioGravacao) / 1000);
          var blob = new Blob(pedacos, { type: gravador.mimeType || mimeType || 'audio/webm' });
          var extensao = (blob.type.split('/')[1] || 'webm').split(';')[0];
          var arquivo = new File([blob], 'audio-gravado.' + extensao, { type: blob.type });

          var dt = new DataTransfer();
          dt.items.add(arquivo);
          inputArquivo.files = dt.files;
          nomeAnexo.textContent = '🎵 Áudio gravado (' + duracao + 's)';
          atualizarBotaoRemover(false);
        });

        gravador.start();
        botaoGravar.classList.add('gravando');
        nomeAnexo.classList.add('gravando-texto');
        nomeAnexo.textContent = '🔴 Gravando... 0:00';
        atualizarBotaoRemover(true);
        cronometro = setInterval(function () {
          nomeAnexo.textContent = '🔴 Gravando... ' + formatarTempo(Date.now() - inicioGravacao);
        }, 500);
      }).catch(function () {
        nomeAnexo.textContent = 'Não consegui acessar o microfone.';
      });
    });

    if (botaoRemover) {
      botaoRemover.addEventListener('click', function () {
        if (gravador && gravador.state === 'recording') {
          cancelando = true;
          gravador.stop(); // dispara 'stop', que limpa tudo por causa de cancelando=true
        } else {
          limparAnexo();
        }
      });
    }
  } else if (botaoGravar) {
    botaoGravar.hidden = true; // navegador sem suporte a gravação — evita mostrar um botão que não funciona
  }
})();
