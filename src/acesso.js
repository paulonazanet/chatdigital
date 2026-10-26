const { db } = require('./db');
const { dentroDasJanelas } = require('./horario');

// Restrições de acesso por atendente (horário e IP) e o histórico de acessos (Atendentes > Histórico
// de acessos). Administrador nunca é barrado (senão alguém poderia trancar o sistema pra todo mundo).

const DIAS_GUARDADOS = 90;
const NOMES_DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function janelasDeAcesso(atendente) {
  try {
    const lista = JSON.parse(atendente?.acesso_horario || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch (erro) {
    return [];
  }
}

function ipsPermitidos(atendente) {
  return String(atendente?.acesso_ips || '')
    .split(/[\s,;]+/)
    .map((ip) => ip.trim())
    .filter(Boolean);
}

// "::ffff:192.168.0.5" (IPv4 dentro de IPv6, como o Node mostra) → "192.168.0.5"
function ipLimpo(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

// IP permitido: igual, ou começando pelo prefixo terminado em ponto/asterisco (ex.: "192.168.0.")
function ipCasa(ip, permitido) {
  const limpo = ipLimpo(ip);
  const regra = permitido.replace(/\*$/, '');
  return regra.endsWith('.') || regra.endsWith(':') ? limpo.startsWith(regra) : limpo === regra;
}

/** Texto curto do horário de acesso, ex.: "seg 08:00-18:00 · sáb 08:00-12:00" (vazio = qualquer hora) */
function resumoDoHorario(atendente) {
  return janelasDeAcesso(atendente)
    .map((j) => {
      const [dias, horas] = String(j).split(' ');
      return `${dias.split(',').map((d) => NOMES_DIAS[Number(d)] || d).join(', ')} ${horas}`;
    })
    .join(' · ');
}

/** Pode usar o painel agora, desse IP? { ok } ou { ok: false, motivo } */
function verificarAcesso(atendente, { ip = '', agora = new Date() } = {}) {
  if (!atendente || atendente.papel === 'admin') return { ok: true };
  const janelas = janelasDeAcesso(atendente);
  if (janelas.length && !dentroDasJanelas(janelas, agora)) {
    return { ok: false, motivo: `Fora do seu horário de acesso (${resumoDoHorario(atendente)}).` };
  }
  const ips = ipsPermitidos(atendente);
  if (ips.length && !ips.some((permitido) => ipCasa(ip, permitido))) {
    return { ok: false, motivo: 'Acesso não liberado deste local (IP). Fale com o administrador.' };
  }
  return { ok: true };
}

const ROTULOS_EVENTO = {
  entrou: 'Entrou',
  saiu: 'Saiu',
  senha_errada: 'Senha errada',
  bloqueado_tentativas: 'Bloqueado por muitas tentativas',
  bloqueado_horario: 'Barrado: fora do horário',
  bloqueado_ip: 'Barrado: IP não liberado',
  desconectado: 'Desconectado: acabou o horário de acesso',
};

function registrarAcesso({ atendenteId = null, email = '', evento, detalhe = null, req = null }) {
  db.prepare('INSERT INTO acessos (criado_em, atendente_id, email, evento, detalhe, ip, navegador) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    new Date().toISOString(),
    atendenteId,
    String(email || '').trim().toLowerCase().slice(0, 120) || null,
    evento,
    detalhe,
    req ? ipLimpo(req.ip).slice(0, 60) : null,
    req ? String(req.get('user-agent') || '').slice(0, 200) : null,
  );
}

// Navegador legível a partir do user-agent (o suficiente pra reconhecer o computador)
function navegadorLegivel(ua) {
  const texto = String(ua || '');
  const sistema = /Android/.test(texto) ? 'Android' : /iPhone|iPad/.test(texto) ? 'iPhone' : /Windows/.test(texto) ? 'Windows' : /Mac OS/.test(texto) ? 'Mac' : /Linux/.test(texto) ? 'Linux' : '';
  const nav = /Edg\//.test(texto) ? 'Edge' : /Chrome\//.test(texto) ? 'Chrome' : /Firefox\//.test(texto) ? 'Firefox' : /Safari\//.test(texto) ? 'Safari' : '';
  return [nav, sistema].filter(Boolean).join(' · ') || (texto ? 'Outro' : '—');
}

function listarAcessos({ atendenteId = null, limite = 300 } = {}) {
  return db
    .prepare(
      `SELECT x.*, a.nome AS atendente_nome FROM acessos x LEFT JOIN atendentes a ON a.id = x.atendente_id
       WHERE (? IS NULL OR x.atendente_id = ?) ORDER BY x.id DESC LIMIT ?`,
    )
    .all(atendenteId, atendenteId, limite)
    .map((x) => ({ ...x, rotulo: ROTULOS_EVENTO[x.evento] || x.evento, navegadorLegivel: navegadorLegivel(x.navegador), falha: x.evento !== 'entrou' && x.evento !== 'saiu' }));
}

// histórico de acessos é dado pessoal da equipe (IP): guarda só os últimos 90 dias
function limparAcessosAntigos(agoraMs = Date.now()) {
  db.prepare('DELETE FROM acessos WHERE criado_em < ?').run(new Date(agoraMs - DIAS_GUARDADOS * 86400000).toISOString());
}

module.exports = { verificarAcesso, janelasDeAcesso, ipsPermitidos, resumoDoHorario, registrarAcesso, listarAcessos, limparAcessosAntigos, navegadorLegivel, ipLimpo, DIAS_GUARDADOS };
