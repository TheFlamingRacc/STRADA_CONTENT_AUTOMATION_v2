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
  enabled:        process.env.ENGAGEMENT_ENABLED !== 'false',
  saveChance:     parseFloat(process.env.SAVE_CHANCE                  ?? '0.3'),
  runsPerDayMin:   parseInt(process.env.ENGAGEMENT_RUNS_PER_DAY_MIN   ?? '4'),
  runsPerDayMax:   parseInt(process.env.ENGAGEMENT_RUNS_PER_DAY_MAX   ?? '7'),
  feedPages:       parseInt(process.env.ENGAGEMENT_FEED_PAGES          ?? '3'),
  feedPerPage:     parseInt(process.env.ENGAGEMENT_FEED_PER_PAGE       ?? '21'),
};

// ─── YOUTUBE ПОСТИ ────────────────────────────────────────────────────────────
export const YOUTUBE_POSTS = {
  enabled:    process.env.YOUTUBE_POSTS_ENABLED !== 'false',
  // Шанс що черговий пост буде YouTube замість RSS (0.0–1.0)
  postChance: parseFloat(process.env.YOUTUBE_POST_CHANCE ?? '0.35'),
};

// ─── STORIES ──────────────────────────────────────────────────────────────────
export const STORIES = {
  enabled:           process.env.STORIES_ENABLED === 'true',
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
