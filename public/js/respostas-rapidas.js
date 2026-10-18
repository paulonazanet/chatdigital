// Respostas rápidas ("/" no campo de resposta ou o botão do raio) e chave "Nota interna".
(function () {
  var form = document.querySelector('.form-responder');
  if (!form) return;
  var textarea = form.querySelector('textarea[name="texto"]');
  var painel = form.querySelector('.respostas-painel');
  var botao = form.querySelector('.botao-respostas');
  var chaveNota = form.querySelector('.chave-nota input');
  var botaoEnviar = form.querySelector('button[type="submit"]');
  var placeholderNormal = textarea ? textarea.placeholder : '';

  // Chave ligada: o campo fica amarelo e o botão vira "Salvar nota", pra não confundir o que vai
  // pro cliente com o que fica só pra equipe.
  if (chaveNota && textarea && botaoEnviar) {
    chaveNota.addEventListener('change', function () {
      form.classList.toggle('modo-nota', chaveNota.checked);
      textarea.placeholder = chaveNota.checked ? 'Nota interna: só a equipe vê. O cliente não recebe.' : placeholderNormal;
      botaoEnviar.textContent = chaveNota.checked ? 'Salvar nota' : 'Enviar';
    });
  }

  var dados = document.getElementById('respostas-rapidas-dados');
  var respostas = [];
  try { respostas = JSON.parse(dados ? dados.textContent : '[]'); } catch (e) {}
  if (!textarea || !painel || respostas.length === 0) return;

  function semAcento(t) {
    return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  var selecionada = 0;
  var filtradas = [];
  var inicioBarra = -1; // posição do "/" que abriu a lista (-1 = aberta pelo botão)

  function fechar() {
    painel.hidden = true;
    inicioBarra = -1;
  }

  function desenhar(termo) {
    var t = semAcento(termo || '');
    filtradas = respostas.filter(function (r) {
      return !t || semAcento(r.nome).indexOf(t) !== -1 || semAcento(r.texto).indexOf(t) !== -1;
    });
    painel.innerHTML = '';
    if (filtradas.length === 0) {
      var vazio = document.createElement('p');
      vazio.className = 'respostas-vazio';
      vazio.textContent = 'Nenhuma resposta rápida com "' + termo + '".';
      painel.appendChild(vazio);
      return;
    }
    if (selecionada >= filtradas.length) selecionada = 0;
    filtradas.forEach(function (r, i) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'resposta-item' + (i === selecionada ? ' ativa' : '');
      var nome = document.createElement('strong');
      nome.textContent = r.nome;
      var previa = document.createElement('span');
      previa.textContent = r.texto;
      item.appendChild(nome);
      item.appendChild(previa);
      item.addEventListener('mousedown', function (ev) { ev.preventDefault(); escolher(i); });
      painel.appendChild(item);
    });
  }

  function escolher(i) {
    var r = filtradas[i];
    if (!r) return;
    var valor = textarea.value;
    var cursor = textarea.selectionStart;
    var antes = inicioBarra >= 0 ? valor.slice(0, inicioBarra) : valor.slice(0, cursor);
    var depois = valor.slice(cursor);
    textarea.value = antes + r.texto + depois;
    var pos = (antes + r.texto).length;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = pos;
    fechar();
    textarea.dispatchEvent(new Event('input')); // guarda o rascunho (fila-responder.js)
  }

  // "/" no começo do campo ou depois de espaço/quebra abre a lista; o que vem depois filtra
  textarea.addEventListener('input', function () {
    var cursor = textarea.selectionStart;
    var antes = textarea.value.slice(0, cursor);
    var m = /(^|\s)\/([^\s\/]*)$/.exec(antes);
    if (m) {
      inicioBarra = cursor - m[2].length - 1;
      painel.hidden = false;
      desenhar(m[2]);
    } else if (inicioBarra >= 0) {
      fechar();
    }
  });

  textarea.addEventListener('keydown', function (ev) {
    if (painel.hidden || filtradas.length === 0) {
      if (ev.key === 'Escape') fechar();
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      selecionada = (selecionada + (ev.key === 'ArrowDown' ? 1 : filtradas.length - 1)) % filtradas.length;
      var termo = inicioBarra >= 0 ? textarea.value.slice(inicioBarra + 1, textarea.selectionStart) : '';
      desenhar(termo);
    } else if (ev.key === 'Enter' || ev.key === 'Tab') {
      ev.preventDefault();
      escolher(selecionada);
    } else if (ev.key === 'Escape') {
      fechar();
    }
  });

  if (botao) {
    botao.addEventListener('click', function () {
      if (!painel.hidden) return fechar();
      inicioBarra = -1;
      selecionada = 0;
      painel.hidden = false;
      desenhar('');
    });
  }
  document.addEventListener('click', function (ev) {
    if (!painel.hidden && !painel.contains(ev.target) && (!botao || !botao.contains(ev.target)) && ev.target !== textarea) fechar();
  });
})();
