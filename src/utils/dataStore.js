import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.js';

// Гарантуємо існування папки data при старті
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.resolve(DATA_DIR, name);
}

function readJson(name, fallback) {
  const fp = filePath(name);
  try {
    return JSON.parse(readFileSync(fp, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, data) {
  writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

// ─── Articles Queue ───────────────────────────────────────────────────────────
export function readQueue()        { return readJson('articles_queue.json', []); }
export function writeQueue(queue)  { writeJson('articles_queue.json', queue); }

export function hasUnusedArticles() {
  return readQueue().some(a => !a.used);
}

// ─── State ────────────────────────────────────────────────────────────────────
export function readState() {
  return readJson('state.json', { last_collect: null, last_publish: null });
}

export function updateState(patch) {
  const state = readState();
  writeJson('state.json', { ...state, ...patch });
}

// ─── Invented Topics ──────────────────────────────────────────────────────────
// Зберігаються у репо — статичний файл, не змінюється в рантаймі
export function readInventedTopics() {
  try {
    return readJson('invented_topics.json', []);
  } catch {
    return [];
  }
}

// ─── User Profiles (аналітика) ────────────────────────────────────────────────
export function readUserProfiles()           { return readJson('user_profiles.json', {}); }
export function writeUserProfiles(profiles)  { writeJson('user_profiles.json', profiles); }

// ─── YouTube published (дедуплікація відео) ───────────────────────────────────
const YOUTUBE_PUBLISHED_LIMIT = 2000;

export function readPublishedVideoIds() {
  const raw = readJson('youtube_published.json', null);
  if (!Array.isArray(raw)) {
    console.warn('⚠️ youtube_published.json недоступний або пошкоджений — відео-дедуплікація пропущена');
    return [];
  }
  return raw;
}

export function markVideoPublished(videoId) {
  const ids = readPublishedVideoIds();
  if (ids.includes(videoId)) return;
  ids.push(videoId);
  if (ids.length > YOUTUBE_PUBLISHED_LIMIT) ids.splice(0, ids.length - YOUTUBE_PUBLISHED_LIMIT);
  writeJson('youtube_published.json', ids);
}

// ─── Articles published (дедуплікація RSS-статей між циклами збору) ───────────
const ARTICLES_PUBLISHED_LIMIT = 2000;

export function readPublishedArticleUrls() {
  const raw = readJson('articles_published.json', null);
  if (!Array.isArray(raw)) return [];
  return raw;
}

export function markArticlePublished(url) {
  if (!url || url === 'invented') return;
  const urls = readPublishedArticleUrls();
  if (urls.includes(url)) return;
  urls.push(url);
  if (urls.length > ARTICLES_PUBLISHED_LIMIT) urls.splice(0, urls.length - ARTICLES_PUBLISHED_LIMIT);
  writeJson('articles_published.json', urls);
}
