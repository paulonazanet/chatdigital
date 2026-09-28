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

  if (inputArquivo && nomeAnexo) {
    inputArquivo.addEventListener('change', function () {
      var arquivo = inputArquivo.files[0];
      nomeAnexo.textContent = arquivo ? arquivo.name : '';
    });
  }
})();
