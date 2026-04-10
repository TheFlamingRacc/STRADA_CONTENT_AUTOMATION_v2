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
