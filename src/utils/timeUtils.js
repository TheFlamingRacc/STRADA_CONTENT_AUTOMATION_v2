/**
 * Обчислює зміщення Київського часового поясу відносно UTC у мілісекундах.
 * Враховує DST: UTC+3 влітку (EEST), UTC+2 взимку (EET).
 */
function _kyivOffsetMs(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone:  'Europe/Kyiv',
      year:      'numeric',
      month:     'numeric',
      day:       'numeric',
      hour:      'numeric',
      minute:    'numeric',
      second:    'numeric',
      hour12:    false,
    }).formatToParts(date).map(({ type, value }) => [type, parseInt(value, 10)])
  );
  const kyiv = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour === 24 ? 0 : parts.hour, parts.minute, parts.second,
  );
  const utc = Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(),
  );
  return kyiv - utc;
}

/**
 * Повертає поточний Date об'єкт у київському часовому поясі.
 * getHours(), getMinutes() тощо повертають київський час.
 * DST-коректно: UTC+2 взимку, UTC+3 влітку.
 */
export function getKyivDate() {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset() * 60000 + _kyivOffsetMs(now));
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
  const diff = targetDate - getKyivDate();
  if (diff <= 0) return 'зараз';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins  = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours === 0) return `${mins}хв`;
  return `${hours}г ${mins}хв`;
}

/**
 * Повертає Unix timestamp (секунди) для використання у Discord <t:X:R>.
 * kyivDate створено через getKyivDate(): epoch = реальний UTC + Kyiv offset.
 * Відніманням поточного offset отримуємо реальний UTC epoch.
 */
export function toDiscordUnix(kyivDate) {
  return Math.floor((kyivDate.getTime() - _kyivOffsetMs(new Date())) / 1000);
}

/**
 * Затримка у мілісекундах.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Рандомна затримка між min і max мс.
 */
export function sleepRandom(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(ms);
}
