/**
 * Повертає поточний Date об'єкт у київському часовому поясі.
 * Працює незалежно від налаштувань сервера (Railway UTC).
 */
export function getKyivDate() {
  const now = new Date();
  const kyivOffset = 3 * 60 * 60 * 1000; // UTC+3 (влітку)
  return new Date(now.getTime() + now.getTimezoneOffset() * 60000 + kyivOffset);
}

/**
 * Форматує Date у рядок HH:MM за київським часом.
 */
export function formatTime(date) {
  return date.toLocaleTimeString('uk-UA', {
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Повертає рядок виду "2г 15хв" до цільового часу.
 */
export function getTimeUntil(targetDate) {
  const diff = targetDate - new Date();
  if (diff <= 0) return 'зараз';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours === 0) return `${mins}хв`;
  return `${hours}г ${mins}хв`;
}

/**
 * Затримка у мілісекундах.
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Рандомна затримка між min і max мс.
 */
export function sleepRandom(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(ms);
}
