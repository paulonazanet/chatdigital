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

module.exports = { dentroDasJanelas };
