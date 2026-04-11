import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── API ──────────────────────────────────────────────────────────────────────
export const BASE_URL      = process.env.BASE_URL       ?? 'https://api.strada.com.ua/api/v1.0';
export const AUTOMATION_KEY = process.env.AUTOMATION_KEY ?? '';

// Кілька Gemini-ключів через кому: KEY1,KEY2,KEY3
export const GEMINI_KEYS = (process.env.GEMINI_KEYS ?? '').split(',').map(k => k.trim()).filter(Boolean);

// YouTube Data API v3
export const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? null;

// ─── ЮЗЕРИ ────────────────────────────────────────────────────────────────────
// Пріоритет: ENV змінна USERS_JSON → файл data/users.json (тільки для локальної розробки)
export function getUsers() {
  if (process.env.USERS_JSON) {
    try {
      return JSON.parse(process.env.USERS_JSON);
    } catch {
      console.error('❌ USERS_JSON: невалідний JSON');
    }
  }

  // Fallback — локальний файл
  const localPath = path.resolve(__dirname, '../data/users.json');
  if (existsSync(localPath)) {
    try {
      return JSON.parse(readFileSync(localPath, 'utf-8'));
    } catch {
      console.error('❌ Не вдалося прочитати data/users.json');
    }
  }

  console.error('❌ Не знайдено ні USERS_JSON, ні data/users.json');
  return [];
}

// ─── РОЗКЛАД ──────────────────────────────────────────────────────────────────
export const SCHEDULE = {
  postsPerDayMin:  parseInt(process.env.POSTS_PER_DAY_MIN  ?? '18'),
  postsPerDayMax:  parseInt(process.env.POSTS_PER_DAY_MAX  ?? '22'),
  activeHourStart: parseInt(process.env.ACTIVE_HOUR_START  ?? '8'),
  activeHourEnd:   parseInt(process.env.ACTIVE_HOUR_END    ?? '23'),
};

// ─── КОНТЕНТ ──────────────────────────────────────────────────────────────────
export const CONTENT = {
  maxNewArticles:       parseInt(process.env.MAX_NEW_ARTICLES        ?? '30'),
  inventedTopicChance: parseFloat(process.env.INVENTED_TOPIC_CHANCE  ?? '0.3'),
  // Розподіл довжини постів (має сумуватись до 1.0)
  shortPostChance:     parseFloat(process.env.SHORT_POST_CHANCE      ?? '0.30'),
  mediumPostChance:    parseFloat(process.env.MEDIUM_POST_CHANCE     ?? '0.35'),
  // longPostChance = 1 - short - medium (решта)
  // YouTube: вставляти відео в пост
  youtubeInPostChance: parseFloat(process.env.YOUTUBE_IN_POST_CHANCE ?? '0.4'),
};

// ─── ENGAGEMENT (лайки, збереження) ──────────────────────────────────────────
export const ENGAGEMENT = {
  enabled:           process.env.ENGAGEMENT_ENABLED !== 'false',
  likesPerRun:        parseInt(process.env.LIKES_PER_RUN        ?? '5'),
  saveChance:        parseFloat(process.env.SAVE_CHANCE          ?? '0.3'),
  // Затримка між діями в мс (щоб не виглядало як бот)
  delayMinMs:         parseInt(process.env.ENGAGEMENT_DELAY_MIN_MS ?? '3000'),
  delayMaxMs:         parseInt(process.env.ENGAGEMENT_DELAY_MAX_MS ?? '8000'),
  // Cron розклад запуску engagement (за Києвом)
  cronSchedule:      process.env.ENGAGEMENT_CRON ?? '0 10,14,18,21 * * *',
};

// ─── STORIES ──────────────────────────────────────────────────────────────────
export const STORIES = {
  enabled:           process.env.STORIES_ENABLED !== 'false',
  perDayMin:          parseInt(process.env.STORIES_PER_DAY_MIN ?? '2'),
  perDayMax:          parseInt(process.env.STORIES_PER_DAY_MAX ?? '5'),
};

// ─── DISCORD ЛОГУВАННЯ ────────────────────────────────────────────────────────
export const DISCORD = {
  webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? null,
  // 'all' — все підряд | 'error' — тільки помилки | 'none' — вимкнено
  logLevel:   process.env.DISCORD_LOG_LEVEL   ?? 'all',
};

// ─── ТЕСТОВИЙ РЕЖИМ ───────────────────────────────────────────────────────────
export const TEST = {
  // Кількість постів для npm run test-publish (або CLI аргумент)
  postsCount: parseInt(process.env.TEST_POSTS_COUNT ?? '3'),
};

// ─── ДАНІ ─────────────────────────────────────────────────────────────────────
// Шлях до папки data — Railway Volume монтується сюди
export const DATA_DIR = process.env.DATA_DIR ?? './data';
