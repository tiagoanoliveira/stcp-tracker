/**
 * Date Helpers - Utilitários para manipulação e formatação de datas
 */

/**
 * Formatar data para YYYYMMDD
 */
export function formatYYYYMMDD(date = new Date()) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Formatar hora para HH:MM:SS
 */
export function formatTime(date = new Date()) {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Formatar data e hora completa
 */
export function formatDateTime(date = new Date()) {
  return `${formatYYYYMMDD(date)} ${formatTime(date)}`;
}

/**
 * Obter dia da semana (0 = Domingo, 6 = Sábado)
 */
export function getWeekday(date = new Date()) {
  return date.getDay();
}

/**
 * Verificar se é fim de semana
 */
export function isWeekend(date = new Date()) {
  const day = getWeekday(date);
  return day === 0 || day === 6;
}

/**
 * Calcular diferença em minutos entre duas datas
 */
export function getDifferenceInMinutes(date1, date2) {
  return Math.floor((date2 - date1) / (1000 * 60));
}

/**
 * Calcular diferença em segundos entre duas datas
 */
export function getDifferenceInSeconds(date1, date2) {
  return Math.floor((date2 - date1) / 1000);
}

/**
 * Formatar duração em ms para string legível
 */
export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

/**
 * Obter timestamp atual
 */
export function now() {
  return Date.now();
}
