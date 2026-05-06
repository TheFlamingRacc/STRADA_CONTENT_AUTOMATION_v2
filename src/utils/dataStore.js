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

// ─── YouTube Stories published (дедуплікація Shorts для сторіс) ──────────────
const STORIES_PUBLISHED_LIMIT = 200;

export function readPublishedStoryVideoIds() {
  const raw = readJson('youtube_stories_published.json', null);
  if (!Array.isArray(raw)) return [];
  return raw;
}

export function markStoryVideoPublished(videoId) {
  const ids = readPublishedStoryVideoIds();
  if (ids.includes(videoId)) return;
  ids.push(videoId);
  if (ids.length > STORIES_PUBLISHED_LIMIT) ids.splice(0, ids.length - STORIES_PUBLISHED_LIMIT);
  writeJson('youtube_stories_published.json', ids);
}

// ─── Community queues (окрема черга на кожну спільноту) ──────────────────────

export function readCommunityQueue(slug)          { return readJson(`articles_queue_${slug}.json`, []); }
export function writeCommunityQueue(slug, queue)  { writeJson(`articles_queue_${slug}.json`, queue); }
export function hasUnusedCommunityArticles(slug)  { return readCommunityQueue(slug).some(a => !a.used); }

const COMMUNITY_VIDEO_LIMIT = 500;

export function readCommunityPublishedVideoIds(slug) {
  const raw = readJson(`youtube_published_${slug}.json`, null);
  if (!Array.isArray(raw)) return [];
  return raw;
}

export function markCommunityVideoPublished(slug, videoId) {
  const ids = readCommunityPublishedVideoIds(slug);
  if (ids.includes(videoId)) return;
  ids.push(videoId);
  if (ids.length > COMMUNITY_VIDEO_LIMIT) ids.splice(0, ids.length - COMMUNITY_VIDEO_LIMIT);
  writeJson(`youtube_published_${slug}.json`, ids);
}

const COMMUNITY_ARTICLES_LIMIT = 2000;

export function readCommunityPublishedArticleUrls(slug) {
  const raw = readJson(`articles_published_${slug}.json`, null);
  if (!Array.isArray(raw)) return [];
  return raw;
}

export function markCommunityArticlePublished(slug, url) {
  if (!url) return;
  const urls = readCommunityPublishedArticleUrls(slug);
  if (urls.includes(url)) return;
  urls.push(url);
  if (urls.length > COMMUNITY_ARTICLES_LIMIT) urls.splice(0, urls.length - COMMUNITY_ARTICLES_LIMIT);
  writeJson(`articles_published_${slug}.json`, urls);
}

// ─── YouTube channel usage (рівномірний розподіл каналів між постами) ───────
// Структура: { [channelId]: { count: N, lastUsed: ISO } }
// Канали обираються в порядку: спочатку найменш використовувані, далі — найдавніше.

function _readChannelUsage(filename) {
  const raw = readJson(filename, null);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function _markChannelUsed(filename, channelId) {
  if (!channelId) return;
  const stats = _readChannelUsage(filename);
  const cur = stats[channelId] ?? { count: 0, lastUsed: null };
  stats[channelId] = { count: cur.count + 1, lastUsed: new Date().toISOString() };
  writeJson(filename, stats);
}

/** Сортує channelIds за least-recently-used (count ASC, lastUsed ASC). */
export function orderChannelsByUsage(channelIds, stats) {
  return [...channelIds].sort((a, b) => {
    const sa = stats[a] ?? { count: 0, lastUsed: null };
    const sb = stats[b] ?? { count: 0, lastUsed: null };
    if (sa.count !== sb.count) return sa.count - sb.count;
    const la = sa.lastUsed ? Date.parse(sa.lastUsed) : 0;
    const lb = sb.lastUsed ? Date.parse(sb.lastUsed) : 0;
    return la - lb;
  });
}

export function readYoutubeChannelUsage()           { return _readChannelUsage('youtube_channel_usage.json'); }
export function markYoutubeChannelUsed(channelId)   { _markChannelUsed('youtube_channel_usage.json', channelId); }

export function readCommunityChannelUsage(slug)               { return _readChannelUsage(`youtube_channel_usage_${slug}.json`); }
export function markCommunityChannelUsed(slug, channelId)     { _markChannelUsed(`youtube_channel_usage_${slug}.json`, channelId); }

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
