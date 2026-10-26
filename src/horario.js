// Janelas de horário, usadas pelo bloco "Horário" do fluxo e pelo horário próprio de cada setor.
// Cada janela é uma string "dias horaInicio-horaFim", ex.: "1,2,3,4,5 08:00-18:00" (dias:
// 0=domingo … 6=sábado, separados por vírgula). `agora` é injetável pra dar pra testar sem
// depender do relógio real.
function dentroDasJanelas(janelas, agora = new Date()) {
  const dia = agora.getDay();
  const hora = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

  return (janelas || []).some((janela) => {
    const [diasStr, horasStr] = String(janela).trim().split(/\s+/);
    if (!diasStr || !horasStr) return false;
    const dias = diasStr.split(',').map((d) => Number(d.trim()));
    if (!dias.includes(dia)) return false;
    const [inicio, fim] = horasStr.split('-');
    return Boolean(inicio) && Boolean(fim) && hora >= inicio && hora <= fim;
  });
}

// Formulário de horário (dias × 2 períodos), usado pelo setor e pelo horário de acesso do atendente:
// o formulário manda inicio_<dia>_<periodo> e fim_<dia>_<periodo> (dia 0 a 6, período 1 ou 2).
function horarioDoCorpo(corpo) {
  const porDia = {};
  for (let dia = 0; dia <= 6; dia += 1) {
    porDia[dia] = [1, 2].map((p) => [String(corpo[`inicio_${dia}_${p}`] || ''), String(corpo[`fim_${dia}_${p}`] || '')]);
  }
  return porDia;
}
function horarioDasJanelas(janelas) {
  const porDia = {};
  for (let dia = 0; dia <= 6; dia += 1) porDia[dia] = [];
  for (const janela of janelas || []) {
    const [diasStr, horas] = String(janela).split(' ');
    const [inicio, fim] = String(horas || '').split('-');
    for (const dia of String(diasStr).split(',').map(Number)) if (porDia[dia]) porDia[dia].push([inicio, fim]);
  }
  return porDia;
}

module.exports = { dentroDasJanelas, horarioDoCorpo, horarioDasJanelas };
