import axios from 'axios';
import { fileURLToPath } from 'url';
import AuthService from '../services/AuthService.js';
import { getUsers, BASE_URL, AUTOMATION_KEY } from '../config.js';
import { readQueue, markVideoPublished, markArticlePublished } from '../utils/dataStore.js';

const PER_PAGE    = 21;
const FETCH_BATCH = 5; // скільки постів фетчимо паралельно за раз

// YouTube video ID (11 символів) з embed URL в iframe
function extractYouTubeIds(html) {
  const ids = new Set();
  const re = /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return [...ids];
}

// Source URL з <a rel="...nofollow..."> — таке посилання додає linkTemplates.js
function extractSourceUrls(html) {
  const urls = [];
  const anchorRe = /<a\b[^>]*\brel="[^"]*nofollow[^"]*"[^>]*>/gi;
  const hrefRe   = /\bhref="(https?:\/\/[^"]+)"/i;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const hrefMatch = hrefRe.exec(m[0]);
    if (!hrefMatch) continue;
    const url = hrefMatch[1];
    if (
      url.includes('strada.com.ua') ||
      url.includes('youtube.com') ||
      url.includes('digitaloceanspaces.com')
    ) continue;
    urls.push(url);
  }
  return urls;
}

function makeHeaders(token) {
  return {
    Authorization:             `Bearer ${token}`,
    'X-Strada-Automation-Key': AUTOMATION_KEY,
  };
}

// Список postів юзера з пагінацією (контент обрізаний — тільки для UUID та YouTube)
async function fetchPostList(username, token) {
  const posts = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await axios.get(`${BASE_URL}/profile/posts/users/${username}/posts`, {
      params:  { page, per_page: PER_PAGE },
      headers: makeHeaders(token),
    });
    const body = res.data?.data;
    if (!body?.items?.length) break;
    posts.push(...body.items);
    totalPages = body.pagination?.total_pages ?? 1;
    page++;
  } while (page <= totalPages);

  return posts;
}

// Повний контент одного поста — source URL знаходиться тут
async function fetchFullPost(uuid, token) {
  try {
    const res = await axios.get(`${BASE_URL}/profile/posts/${uuid}`, {
      headers: makeHeaders(token),
    });
    return res.data?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Ретроактивна синхронізація articles_published.json і youtube_published.json.
 *
 * Алгоритм:
 * 1. articles_queue.json — URL ще не прунутих опублікованих статей
 * 2. List API → отримуємо UUIDs + YouTube ID (embed видно навіть в обрізаному контенті)
 * 3. Individual API (GET /profile/posts/{uuid}) — повний контент → source URL
 *    Фетчимо батчами по FETCH_BATCH паралельно щоб не затягувати старт надовго.
 */
export async function syncPublishedHistory(users = null) {
  const allUsers = users ?? getUsers();
  console.log('\n🔄 [sync] Синхронізуємо історію публікацій...');

  let totalUrls = 0;
  let totalIds  = 0;

  // Фаза 1: articles_queue.json
  const queueUrls = readQueue()
    .filter(a => a.used && a.url && a.url !== 'invented')
    .map(a => a.url);
  for (const url of queueUrls) markArticlePublished(url);
  totalUrls += queueUrls.length;
  console.log(`  📚 З черги: ${queueUrls.length} URL статей`);

  // Фаза 2: Strada API — всі юзери паралельно
  const results = await Promise.all(allUsers.map(async user => {
    try {
      const { token, username } = await AuthService.login(user.email, user.password);
      const posts = await fetchPostList(username, token);

      const ids  = [];
      const urls = [];

      // YouTube IDs — витягуємо з list-контенту (embed видно навіть в обрізаному)
      for (const post of posts) {
        for (const id of extractYouTubeIds(post.content ?? '')) ids.push(id);
      }

      // Source URLs — потребують повного контенту, фетчимо батчами паралельно
      for (let i = 0; i < posts.length; i += FETCH_BATCH) {
        const batch = posts.slice(i, i + FETCH_BATCH);
        const fullPosts = await Promise.all(batch.map(p => fetchFullPost(p.uuid, token)));
        for (const full of fullPosts) {
          if (!full) continue;
          for (const url of extractSourceUrls(full.content ?? '')) urls.push(url);
        }
      }

      AuthService.clearToken(user.email);
      console.log(`  👤 ${user.character_name}: ${posts.length} постів → ${ids.length} відео, ${urls.length} URL`);
      return { ids, urls };
    } catch (err) {
      console.warn(`  ⚠️  Sync ${user.character_name}: ${err.message}`);
      AuthService.clearToken(user.email);
      return { ids: [], urls: [] };
    }
  }));

  // Записуємо в файли після того як всі юзери завершились
  for (const { ids, urls } of results) {
    for (const id  of ids)  { markVideoPublished(id);  totalIds++; }
    for (const url of urls) { markArticlePublished(url); totalUrls++; }
  }

  console.log(`✅ [sync] Готово: ${totalIds} відео ID, ${totalUrls} URL статей зафіксовано`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  syncPublishedHistory().catch(console.error);
}
