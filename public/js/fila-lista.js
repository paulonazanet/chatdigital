// Mantém o "há X min" e a cor da bolinha da fila andando sozinhos, sem recarregar a página — os
// limites de amarelo/vermelho vêm de Configurações (data-minutos-* na lista). Mesma regra de
// haQuanto/corDaBolinha em views/fila/lista.ejs, que faz o primeiro desenho no servidor.
(function () {
  var lista = document.querySelector('.fila-lista');
  if (!lista) return;

  var minutosAmarelo = Number(lista.getAttribute('data-minutos-amarelo')) || 0;
  var minutosVermelho = Number(lista.getAttribute('data-minutos-vermelho')) || 0;

  function minutosDesde(iso) {
    return (Date.now() - new Date(iso).getTime()) / 60000;
  }

  function haQuanto(iso) {
    var min = Math.max(0, Math.floor(minutosDesde(iso)));
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    if (min < 1440) return 'há ' + Math.floor(min / 60) + ' h';
    return 'há ' + Math.floor(min / 1440) + (min < 2880 ? ' dia' : ' dias');
  }

  function corDaBolinha(iso) {
    var min = minutosDesde(iso);
    if (min >= minutosVermelho) return 'vermelha';
    if (min >= minutosAmarelo) return 'amarela';
    return 'verde';
  }

  function atualizar() {
    lista.querySelectorAll('.item-tempo[data-desde]').forEach(function (el) {
      el.textContent = haQuanto(el.getAttribute('data-desde'));
    });
    lista.querySelectorAll('.bolinha[data-desde]').forEach(function (el) {
      el.className = 'bolinha bolinha-' + corDaBolinha(el.getAttribute('data-desde'));
    });
  }

  setInterval(atualizar, 30000);

  // Menu de setor e lápis do nome são <details>: fecham sozinhos ao clicar fora, como um menu normal
  document.addEventListener('click', function (ev) {
    document.querySelectorAll('.filtro-setor[open], .renomear-popover[open]').forEach(function (menu) {
      if (!menu.contains(ev.target)) menu.open = false;
    });
  });

  // Busca por número ou nome: filtra na hora o que já está na lista (mesma regra de
  // conversaCasaComBusca em src/conversas.js). Em "Finalizadas" a lista só traz as 50 mais
  // recentes, então depois de uma pausa na digitação também busca no servidor (banco inteiro).
  var campoBusca = lista.querySelector('.busca-cliente input[name="q"]');
  if (!campoBusca) return;
  var avisoVazio = lista.querySelector('.fila-busca-vazia');
  var ehFinalizadas = lista.querySelector('.busca-cliente input[name="filtro"]').value === 'finalizadas';
  var buscaInicial = campoBusca.value;

  function normalizar(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }

  // celular sem o nono dígito: quem busca "99685" também acha "8196850663"
  function variantesDoNumero(digitos) {
    var variantes = [digitos];
    var comDdd = /^(55)?(\d{2})9(\d{8})$/.exec(digitos);
    if (comDdd) variantes.push((comDdd[1] || '') + comDdd[2] + comDdd[3]);
    else if (digitos.length >= 5 && digitos[0] === '9') variantes.push(digitos.slice(1));
    return variantes;
  }

  function casa(item, termo) {
    if (!termo) return true;
    var partes = (item.getAttribute('data-busca') || '').split('|');
    if (/^[\d\s()+-]+$/.test(termo)) {
      var numeros = partes[0].replace(/\s+/g, ' ');
      return variantesDoNumero(termo.replace(/\D/g, '')).some(function (v) {
        return numeros.split(' ').some(function (n) { return n.indexOf(v) !== -1; });
      });
    }
    return (partes[1] || '').indexOf(termo) !== -1;
  }

  var espera = null;
  campoBusca.addEventListener('input', function () {
    var termo = normalizar(campoBusca.value);
    var itens = lista.querySelectorAll('.item-conversa');
    var visiveis = 0;
    itens.forEach(function (item) {
      var mostra = casa(item, termo);
      item.hidden = !mostra;
      if (mostra) visiveis++;
    });
    if (avisoVazio) avisoVazio.hidden = !(itens.length > 0 && visiveis === 0);

    if (ehFinalizadas && campoBusca.value.trim() !== buscaInicial.trim()) {
      clearTimeout(espera);
      espera = setTimeout(function () { campoBusca.form.submit(); }, 700);
    }
  });

  // voltou de uma busca no servidor: cursor no fim do texto pra continuar digitando
  if (buscaInicial) {
    campoBusca.focus();
    campoBusca.setSelectionRange(buscaInicial.length, buscaInicial.length);
  }
})();
