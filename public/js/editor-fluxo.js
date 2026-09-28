(function () {
  var fluxo = null;
  var sujo = false;
  var noSelecionadoId = null;
  var arrastandoNo = null; // { id, dx, dy }
  var conectando = null; // { noOrigemId, saidaId, origem: {x,y}, atual: {x,y} }
  var contadorNovoId = 1;

  var quadro = document.getElementById('quadro-fluxo');
  var svg = document.getElementById('camada-conexoes');
  var painel = document.getElementById('painel-edicao');
  var mensagemEl = document.getElementById('mensagem-editor');

  var ROTULOS_TIPO = {
    inicio: 'Início',
    mensagem: 'Mensagem',
    pergunta: 'Pergunta',
    condicao: 'Condição',
    salvar: 'Salvar registro',
    api: 'Chamar API',
    transferir: 'Transferir',
    fim: 'Fim',
  };

  function marcarSujo() {
    sujo = true;
    mensagemEl.textContent = 'Alterações não salvas';
    mensagemEl.className = 'mensagem-editor mensagem-editor-pendente';
  }

  function marcarSalvo() {
    sujo = false;
    mensagemEl.textContent = 'Tudo salvo';
    mensagemEl.className = 'mensagem-editor mensagem-editor-ok';
  }

  window.addEventListener('beforeunload', function (ev) {
    if (sujo) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });

  // ---- saídas de cada nó: onde a linha pode sair, e como ler/gravar o destino dela ----

  function obterSaidas(no) {
    if (no.tipo === 'pergunta') {
      var saidas = [];
      if (Array.isArray(no.opcoes)) {
        no.opcoes.forEach(function (op, i) {
          saidas.push({
            id: 'opcao-' + i,
            rotulo: op.quando,
            obter: function () { return op.proximo; },
            definir: function (v) { op.proximo = v; },
          });
        });
      }
      if (no.opcao_extra) {
        saidas.push({
          id: 'extra',
          rotulo: no.opcao_extra.quando,
          obter: function () { return no.opcao_extra.proximo; },
          definir: function (v) { no.opcao_extra.proximo = v; },
        });
      }
      if ((!no.opcoes || no.opcoes.length === 0) && !no.opcao_extra) {
        saidas.push({
          id: 'proximo',
          rotulo: '',
          obter: function () { return no.proximo; },
          definir: function (v) { no.proximo = v; },
        });
      } else if (no.opcoes_dinamicas) {
        saidas.push({
          id: 'proximo',
          rotulo: 'depois de escolher',
          obter: function () { return no.proximo; },
          definir: function (v) { no.proximo = v; },
        });
      }
      return saidas;
    }

    if (no.tipo === 'condicao') {
      var saidasCond = (no.casos || []).map(function (c, i) {
        return {
          id: 'caso-' + i,
          rotulo: c.quando,
          obter: function () { return c.proximo; },
          definir: function (v) { c.proximo = v; },
        };
      });
      saidasCond.push({
        id: 'padrao',
        rotulo: 'padrão',
        obter: function () { return no.padrao; },
        definir: function (v) { no.padrao = v; },
      });
      return saidasCond;
    }

    if (no.tipo === 'api') {
      return [
        { id: 'proximo', rotulo: 'sucesso', obter: function () { return no.proximo; }, definir: function (v) { no.proximo = v; } },
        { id: 'proximo_erro', rotulo: 'erro', obter: function () { return no.proximo_erro; }, definir: function (v) { no.proximo_erro = v; } },
      ];
    }

    if (no.tipo === 'transferir' || no.tipo === 'fim') return [];

    return [{ id: 'proximo', rotulo: '', obter: function () { return no.proximo; }, definir: function (v) { no.proximo = v; } }];
  }

  function resumoNo(no) {
    if (no.tipo === 'condicao') return 'variável: ' + (no.variavel || '—');
    if (no.tipo === 'transferir') return 'setor: ' + (no.setor || '—');
    if (no.tipo === 'salvar') return 'coleção: ' + (no.colecao || '—');
    if (no.tipo === 'api') return (no.metodo || 'GET') + ' ' + (no.url || '—');
    if (no.tipo === 'fim' || no.tipo === 'inicio') return '';
    var texto = no.texto || (no.texto_dinamico ? '(lista dinâmica)' : '');
    return texto.length > 70 ? texto.slice(0, 70) + '…' : texto;
  }

  // ---- geometria ----

  function posRelativa(el) {
    var r1 = el.getBoundingClientRect();
    var r2 = quadro.getBoundingClientRect();
    return { x: r1.left - r2.left + r1.width / 2, y: r1.top - r2.top + r1.height / 2 };
  }

  function garantirPosicoes() {
    if (!fluxo._layout) fluxo._layout = {};
    var i = 0;
    Object.keys(fluxo.nos).forEach(function (id) {
      if (!fluxo._layout[id]) {
        fluxo._layout[id] = { x: 60 + (i % 4) * 260, y: 60 + Math.floor(i / 4) * 190 };
      }
      i++;
    });
  }

  // ---- desenho ----

  function gerarCaminhoOrtogonal(p1, p2) {
    var folga = 28;

    if (p2.x - p1.x >= folga * 2) {
      var meioX = (p1.x + p2.x) / 2;
      return 'M ' + p1.x + ' ' + p1.y + ' L ' + meioX + ' ' + p1.y + ' L ' + meioX + ' ' + p2.y + ' L ' + p2.x + ' ' + p2.y;
    }

    // destino atrás (ou muito perto) da origem: contorna por baixo do ponto mais baixo dos dois
    var saidaX = p1.x + folga;
    var entradaX = p2.x - folga;
    var meioY = Math.max(p1.y, p2.y) + 45;
    return (
      'M ' + p1.x + ' ' + p1.y +
      ' L ' + saidaX + ' ' + p1.y +
      ' L ' + saidaX + ' ' + meioY +
      ' L ' + entradaX + ' ' + meioY +
      ' L ' + entradaX + ' ' + p2.y +
      ' L ' + p2.x + ' ' + p2.y
    );
  }

  function desenharLinha(classe, p1, p2, dadosExtra) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', gerarCaminhoOrtogonal(p1, p2));
    path.setAttribute('class', classe);
    if (dadosExtra) {
      Object.keys(dadosExtra).forEach(function (k) { path.dataset[k] = dadosExtra[k]; });
    }
    svg.appendChild(path);
    return path;
  }

  function redesenharConexoes() {
    svg.innerHTML = '';

    Object.keys(fluxo.nos).forEach(function (id) {
      var no = fluxo.nos[id];
      obterSaidas(no).forEach(function (saida) {
        var alvo = saida.obter();
        if (!alvo || !fluxo.nos[alvo]) return;
        var elOrigem = quadro.querySelector('.alca-saida-ponto[data-no="' + id + '"][data-saida="' + saida.id + '"]');
        var elDestino = quadro.querySelector('.alca-entrada[data-no="' + alvo + '"]');
        if (!elOrigem || !elDestino) return;

        var linha = desenharLinha('linha-conexao', posRelativa(elOrigem), posRelativa(elDestino), { noOrigem: id, saida: saida.id });
        linha.addEventListener('click', function () {
          if (!confirm('Apagar essa conexão?')) return;
          saida.definir(null);
          marcarSujo();
          redesenharConexoes();
        });
      });
    });

    if (conectando) {
      desenharLinha('linha-conexao linha-conexao-temp', conectando.origem, conectando.atual);
    }
  }

  function renderizarNo(id) {
    var existente = quadro.querySelector('.no-fluxo[data-id="' + id + '"]');
    if (existente) existente.remove();

    var no = fluxo.nos[id];
    var pos = fluxo._layout[id];

    var div = document.createElement('div');
    div.className = 'no-fluxo no-fluxo-' + no.tipo;
    div.dataset.id = id;
    div.style.left = pos.x + 'px';
    div.style.top = pos.y + 'px';

    var cabecalho = document.createElement('div');
    cabecalho.className = 'no-cabecalho';
    cabecalho.textContent = (ROTULOS_TIPO[no.tipo] || no.tipo) + (id === fluxo.inicio ? ' ★' : '');
    div.appendChild(cabecalho);

    var idEl = document.createElement('div');
    idEl.className = 'no-id';
    idEl.textContent = id;
    div.appendChild(idEl);

    var corpo = resumoNo(no);
    if (corpo) {
      var corpoEl = document.createElement('div');
      corpoEl.className = 'no-corpo';
      corpoEl.textContent = corpo;
      div.appendChild(corpoEl);
    }

    if (id !== fluxo.inicio) {
      var entrada = document.createElement('div');
      entrada.className = 'alca-entrada';
      entrada.dataset.no = id;
      div.appendChild(entrada);
    }

    var saidas = obterSaidas(no);
    if (saidas.length > 0) {
      var listaSaidas = document.createElement('div');
      listaSaidas.className = 'alcas-saida';
      saidas.forEach(function (saida) {
        var linha = document.createElement('div');
        linha.className = 'alca-saida-linha';
        if (saida.rotulo) {
          var rotulo = document.createElement('span');
          rotulo.className = 'alca-saida-rotulo';
          rotulo.textContent = saida.rotulo;
          linha.appendChild(rotulo);
        }
        var ponto = document.createElement('div');
        ponto.className = 'alca-saida-ponto';
        ponto.dataset.no = id;
        ponto.dataset.saida = saida.id;
        linha.appendChild(ponto);
        listaSaidas.appendChild(linha);
      });
      div.appendChild(listaSaidas);
    }

    quadro.appendChild(div);
  }

  function renderizarTudo() {
    quadro.querySelectorAll('.no-fluxo').forEach(function (el) { el.remove(); });
    Object.keys(fluxo.nos).forEach(renderizarNo);
    redesenharConexoes();
  }

  // ---- painel de edição ----

  function campoTexto(rotulo, valor, aoMudar, multilinha) {
    var wrapper = document.createElement('label');
    wrapper.className = 'campo-editor';
    var span = document.createElement('span');
    span.textContent = rotulo;
    wrapper.appendChild(span);
    var input = document.createElement(multilinha ? 'textarea' : 'input');
    if (!multilinha) input.type = 'text';
    input.value = valor || '';
    input.addEventListener('input', function () {
      aoMudar(input.value);
      marcarSujo();
    });
    wrapper.appendChild(input);
    return wrapper;
  }

  function campoListaSimples(titulo, itens, criarItem, aoAdicionar, aoRemover) {
    var container = document.createElement('div');
    container.className = 'campo-lista';
    var p = document.createElement('p');
    p.className = 'campo-lista-titulo';
    p.textContent = titulo;
    container.appendChild(p);

    itens.forEach(function (item, i) {
      var linha = document.createElement('div');
      linha.className = 'campo-lista-linha';
      linha.appendChild(criarItem(item, i));
      var remover = document.createElement('button');
      remover.type = 'button';
      remover.className = 'campo-lista-remover';
      remover.textContent = '×';
      remover.addEventListener('click', function () {
        aoRemover(i);
        marcarSujo();
        renderizarPainel(noSelecionadoId);
        renderizarNo(noSelecionadoId);
        redesenharConexoes();
      });
      linha.appendChild(remover);
      container.appendChild(linha);
    });

    var adicionar = document.createElement('button');
    adicionar.type = 'button';
    adicionar.className = 'campo-lista-adicionar';
    adicionar.textContent = '+ Adicionar';
    adicionar.addEventListener('click', function () {
      aoAdicionar();
      marcarSujo();
      renderizarPainel(noSelecionadoId);
      renderizarNo(noSelecionadoId);
      redesenharConexoes();
    });
    container.appendChild(adicionar);

    return container;
  }

  function renderizarPainel(id) {
    noSelecionadoId = id;
    var no = fluxo.nos[id];
    painel.innerHTML = '';

    var titulo = document.createElement('h2');
    titulo.textContent = (ROTULOS_TIPO[no.tipo] || no.tipo);
    painel.appendChild(titulo);

    var subtitulo = document.createElement('p');
    subtitulo.className = 'dica';
    subtitulo.textContent = id;
    painel.appendChild(subtitulo);

    if (no.tipo === 'mensagem' || no.tipo === 'transferir') {
      painel.appendChild(campoTexto('Texto', no.texto, function (v) { no.texto = v; renderizarNo(id); }, true));
    }

    if (no.tipo === 'transferir') {
      painel.appendChild(campoTexto('Setor', no.setor, function (v) { no.setor = v; renderizarNo(id); }));
    }

    if (no.tipo === 'pergunta') {
      painel.appendChild(campoTexto('Texto da pergunta', no.texto, function (v) { no.texto = v; renderizarNo(id); }, true));
      painel.appendChild(campoTexto('Guardar resposta na variável (opcional)', no.variavel, function (v) { no.variavel = v || undefined; }));

      if (!no.opcoes) no.opcoes = [];
      painel.appendChild(
        campoListaSimples(
          'Opções (o destino de cada uma se conecta no quadro)',
          no.opcoes,
          function (op) {
            var input = document.createElement('input');
            input.type = 'text';
            input.value = op.quando;
            input.addEventListener('input', function () {
              op.quando = input.value;
              renderizarNo(id);
            });
            return input;
          },
          function () { no.opcoes.push({ quando: String(no.opcoes.length + 1) }); },
          function (i) { no.opcoes.splice(i, 1); },
        ),
      );
    }

    if (no.tipo === 'condicao') {
      painel.appendChild(campoTexto('Variável', no.variavel, function (v) { no.variavel = v; }));

      if (!no.casos) no.casos = [];
      painel.appendChild(
        campoListaSimples(
          'Casos (o destino de cada um se conecta no quadro)',
          no.casos,
          function (c) {
            var input = document.createElement('input');
            input.type = 'text';
            input.value = c.quando;
            input.addEventListener('input', function () {
              c.quando = input.value;
              renderizarNo(id);
            });
            return input;
          },
          function () { no.casos.push({ quando: '' }); },
          function (i) { no.casos.splice(i, 1); },
        ),
      );
    }

    if (no.tipo === 'salvar') {
      painel.appendChild(campoTexto('Coleção', no.colecao, function (v) { no.colecao = v; renderizarNo(id); }));

      if (!no.campos) no.campos = {};
      var chaves = Object.keys(no.campos);
      painel.appendChild(
        campoListaSimples(
          'Campos salvos (nome → caminho, ex.: vars.endereco)',
          chaves,
          function (chave) {
            var envolucro = document.createElement('div');
            envolucro.className = 'campo-par';
            var inputChave = document.createElement('input');
            inputChave.type = 'text';
            inputChave.value = chave;
            inputChave.placeholder = 'nome';
            var valorAtual = no.campos[chave];
            var inputValor = document.createElement('input');
            inputValor.type = 'text';
            inputValor.value = valorAtual;
            inputValor.placeholder = 'vars.campo';
            inputChave.addEventListener('change', function () {
              var novo = inputChave.value.trim();
              if (novo && novo !== chave) {
                no.campos[novo] = no.campos[chave];
                delete no.campos[chave];
              }
            });
            inputValor.addEventListener('input', function () {
              no.campos[inputChave.value.trim() || chave] = inputValor.value;
            });
            envolucro.appendChild(inputChave);
            envolucro.appendChild(inputValor);
            return envolucro;
          },
          function () { no.campos['campo' + (Object.keys(no.campos).length + 1)] = ''; },
          function (i) { delete no.campos[chaves[i]]; },
        ),
      );
    }

    if (no.tipo === 'api') {
      painel.appendChild(campoTexto('URL', no.url, function (v) { no.url = v; renderizarNo(id); }));
      var wrapperMetodo = document.createElement('label');
      wrapperMetodo.className = 'campo-editor';
      var spanMetodo = document.createElement('span');
      spanMetodo.textContent = 'Método';
      wrapperMetodo.appendChild(spanMetodo);
      var selectMetodo = document.createElement('select');
      ['GET', 'POST'].forEach(function (m) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if ((no.metodo || 'GET') === m) opt.selected = true;
        selectMetodo.appendChild(opt);
      });
      selectMetodo.addEventListener('change', function () { no.metodo = selectMetodo.value; renderizarNo(id); });
      wrapperMetodo.appendChild(selectMetodo);
      painel.appendChild(wrapperMetodo);
      painel.appendChild(campoTexto('Guardar resposta na variável', no.guardar_em, function (v) { no.guardar_em = v || undefined; }));
    }

    if (no.tipo === 'fim') {
      painel.appendChild(campoTexto('Texto (opcional)', no.texto, function (v) { no.texto = v || undefined; }, true));
    }

    if (id !== fluxo.inicio) {
      var excluir = document.createElement('button');
      excluir.type = 'button';
      excluir.className = 'botao-secundario botao-excluir';
      excluir.textContent = 'Excluir bloco';
      excluir.addEventListener('click', function () { excluirNo(id); });
      painel.appendChild(excluir);
    } else {
      var avisoInicio = document.createElement('p');
      avisoInicio.className = 'dica';
      avisoInicio.textContent = 'Este é o bloco inicial do fluxo — não pode ser excluído.';
      painel.appendChild(avisoInicio);
    }
  }

  function fecharPainel() {
    noSelecionadoId = null;
    painel.innerHTML = '<p class="dica">Clique num bloco no quadro pra editar aqui.</p>';
  }

  function excluirNo(id) {
    if (!confirm('Excluir este bloco? Conexões que apontam pra ele ficam quebradas até você reconectar.')) return;
    delete fluxo.nos[id];
    delete fluxo._layout[id];
    marcarSujo();
    fecharPainel();
    renderizarTudo();
  }

  // ---- adicionar bloco novo ----

  function gerarIdNovo(tipo) {
    var id;
    do {
      id = 'novo-' + tipo + '-' + contadorNovoId;
      contadorNovoId++;
    } while (fluxo.nos[id]);
    return id;
  }

  function noPadrao(tipo) {
    switch (tipo) {
      case 'mensagem': return { tipo: tipo, texto: 'Escreva a mensagem aqui...' };
      case 'pergunta': return { tipo: tipo, texto: 'Escreva a pergunta aqui...', opcoes: [] };
      case 'condicao': return { tipo: tipo, variavel: '', casos: [] };
      case 'transferir': return { tipo: tipo, texto: 'Encaminhando para um atendente humano.', setor: 'Geral' };
      case 'salvar': return { tipo: tipo, colecao: 'registros', campos: {} };
      case 'api': return { tipo: tipo, url: '', metodo: 'GET' };
      case 'fim': return { tipo: tipo };
      default: return { tipo: tipo };
    }
  }

  document.querySelectorAll('.botao-paleta').forEach(function (botao) {
    botao.addEventListener('click', function () {
      var tipo = botao.dataset.tipo;
      var id = gerarIdNovo(tipo);
      fluxo.nos[id] = noPadrao(tipo);
      var contagem = Object.keys(fluxo.nos).length;
      fluxo._layout[id] = { x: 80 + (contagem % 5) * 220, y: 80 + Math.floor(contagem / 5) * 170 };
      marcarSujo();
      renderizarNo(id);
      redesenharConexoes();
      renderizarPainel(id);
    });
  });

  // ---- arrastar nó / conectar / clicar ----

  quadro.addEventListener('mousedown', function (ev) {
    var pontoSaida = ev.target.closest('.alca-saida-ponto');
    if (pontoSaida) {
      var origem = posRelativa(pontoSaida);
      conectando = {
        noOrigemId: pontoSaida.dataset.no,
        saidaId: pontoSaida.dataset.saida,
        origem: origem,
        atual: origem,
      };
      ev.preventDefault();
      return;
    }

    var no = ev.target.closest('.no-fluxo');
    if (!no) return;
    var pos = fluxo._layout[no.dataset.id];
    arrastandoNo = {
      id: no.dataset.id,
      dx: ev.clientX - pos.x - quadro.getBoundingClientRect().left,
      dy: ev.clientY - pos.y - quadro.getBoundingClientRect().top,
      moveu: false,
    };
  });

  document.addEventListener('mousemove', function (ev) {
    var rectQuadro = quadro.getBoundingClientRect();

    if (conectando) {
      conectando.atual = { x: ev.clientX - rectQuadro.left, y: ev.clientY - rectQuadro.top };
      redesenharConexoes();
      return;
    }

    if (arrastandoNo) {
      var novoX = ev.clientX - rectQuadro.left - arrastandoNo.dx;
      var novoY = ev.clientY - rectQuadro.top - arrastandoNo.dy;
      if (Math.abs(novoX - fluxo._layout[arrastandoNo.id].x) > 2 || Math.abs(novoY - fluxo._layout[arrastandoNo.id].y) > 2) {
        arrastandoNo.moveu = true;
      }
      fluxo._layout[arrastandoNo.id] = { x: Math.max(0, novoX), y: Math.max(0, novoY) };
      var el = quadro.querySelector('.no-fluxo[data-id="' + arrastandoNo.id + '"]');
      el.style.left = fluxo._layout[arrastandoNo.id].x + 'px';
      el.style.top = fluxo._layout[arrastandoNo.id].y + 'px';
      redesenharConexoes();
    }
  });

  document.addEventListener('mouseup', function (ev) {
    if (conectando) {
      var alvoEntrada = ev.target.closest('.alca-entrada');
      if (alvoEntrada) {
        var noOrigem = fluxo.nos[conectando.noOrigemId];
        var saida = obterSaidas(noOrigem).filter(function (s) { return s.id === conectando.saidaId; })[0];
        if (saida) {
          saida.definir(alvoEntrada.dataset.no);
          marcarSujo();
        }
      }
      conectando = null;
      redesenharConexoes();
    }

    if (arrastandoNo) {
      if (arrastandoNo.moveu) marcarSujo();
      else renderizarPainel(arrastandoNo.id);
      arrastandoNo = null;
    }
  });

  // ---- carregar / salvar ----

  function carregar() {
    return fetch('/painel/fluxo/dados')
      .then(function (r) { return r.json(); })
      .then(function (dados) {
        fluxo = dados;
        garantirPosicoes();
        renderizarTudo();
        marcarSalvo();
      });
  }

  function salvar() {
    fetch('/painel/fluxo/salvar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fluxo),
    })
      .then(function (r) { return r.json().then(function (corpo) { return { status: r.status, corpo: corpo }; }); })
      .then(function (res) {
        if (res.corpo.ok) {
          marcarSalvo();
        } else {
          mensagemEl.textContent = 'Não salvou: ' + res.corpo.erros.join(' | ');
          mensagemEl.className = 'mensagem-editor mensagem-editor-erro';
        }
      })
      .catch(function () {
        mensagemEl.textContent = 'Erro de conexão ao salvar.';
        mensagemEl.className = 'mensagem-editor mensagem-editor-erro';
      });
  }

  document.getElementById('botao-salvar-fluxo').addEventListener('click', salvar);

  carregar();
})();
