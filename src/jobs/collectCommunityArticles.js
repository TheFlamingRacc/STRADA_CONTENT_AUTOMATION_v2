import { fileURLToPath } from 'url';
import path from 'path';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import fetch from 'node-fetch';
import sizeOf from 'image-size';
import RssService from '../services/RssService.js';
import GeminiService from '../services/GeminiService.js';
import {
  readCommunityQueue,
  writeCommunityQueue,
  readCommunityPublishedArticleUrls,
} from '../utils/dataStore.js';
import { DATA_DIR, CONTENT } from '../config.js';
import DiscordLogger from '../utils/DiscordLogger.js';

const WEEK_MS   = 7 * 24 * 60 * 60 * 1000;
const IMG_CACHE = path.join(DATA_DIR, 'img_cache');

function deleteImageFiles(articles) {
  for (const article of articles) {
    for (const cachePath of article.imagePaths ?? []) {
      if (cachePath) try { unlinkSync(cachePath); } catch {}
    }
  }
}

async function validateAndCache(imageUrl) {
  let buffer, contentType;
  try {
    const res = await fetch(imageUrl, { timeout: 10_000 });
    if (!res.ok) return null;
    buffer = await res.buffer();
    if (buffer.length < 20_480) return null;
    try {
      const { width, height } = sizeOf(buffer);
      if (width && height && (width < 400 || height < 250)) return null;
    } catch { /* формат не розпізнано */ }
    contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const relevant = await GeminiService.isImageRelevant(buffer, contentType);
    if (!relevant) return null;
  } catch {
    return { url: imageUrl, cachePath: null };
  }

  try {
    mkdirSync(IMG_CACHE, { recursive: true });
    const ext       = contentType.split('/')[1] || 'jpg';
    const filename  = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const cachePath = path.join(IMG_CACHE, filename);
    writeFileSync(cachePath, buffer);
    return { url: imageUrl, cachePath };
  } catch {
    return { url: imageUrl, cachePath: null };
  }
}

/**
 * Збирає статті для конкретної спільноти з її RSS джерел.
 * Зберігає в окрему чергу articles_queue_{slug}.json.
 *
 * @param {object} community — об'єкт спільноти з rss_sources, slug, name
 */
export async function collectCommunityArticles(community) {
  const { slug, name, rss_sources = [] } = community;
  const limit = CONTENT.maxNewArticles;

  console.log(`\n🔍 [collect:${slug}] Збір для "${name}" (ліміт: ${limit})...`);

  if (!rss_sources.length) {
    console.warn(`⚠️  [${slug}] Немає RSS-джерел`);
    return;
  }

  const discordMsgId = await DiscordLogger.collectCommunityStarted(name, limit);

  const existing = readCommunityQueue(slug);

  const pruned = existing.filter(
    a => a.used && a.collected_at && new Date(a.collected_at).getTime() <= Date.now() - WEEK_MS,
  );
  deleteImageFiles(pruned);

  const fresh = existing.filter(
    a => !a.used || !a.collected_at || new Date(a.collected_at).getTime() > Date.now() - WEEK_MS,
  );

  const publishedArticleUrls = readCommunityPublishedArticleUrls(slug);
  const existingUrls         = new Set([...existing.map(a => a.url).filter(Boolean), ...publishedArticleUrls]);

  // ─── Фаза 1: Завантаження RSS і фільтрація ─────────────────────────────────
  const allArticles = await RssService.fetchFeeds(rss_sources);
  console.log(`📰 [${slug}] RSS: знайдено ${allArticles.length} статей`);

  const newArticles = allArticles.filter(a => a.url && !existingUrls.has(a.url));
  console.log(`📰 [${slug}] Нових (без дублів): ${newArticles.length}`);

  console.log(`🤖 [${slug}] Перевіряємо тематику ${newArticles.length} статей...`);
  const relevant = [];

  for (let i = 0; i < newArticles.length; i++) {
    const article = newArticles[i];
    try {
      const isRelated = await GeminiService.isCommunityRelated(
        article.title,
        article.summary,
        name,
        community.prompt,
      );
      if (isRelated) {
        relevant.push(article);
      } else {
        console.log(`⏭️  [${slug}] Нерелевантно: ${article.title.slice(0, 50)}`);
      }
    } catch (err) {
      console.warn(`⚠️  [${slug}] Аналіз тематики: ${err.message}`);
    }

    if ((i + 1) % 5 === 0 || i === newArticles.length - 1) {
      await DiscordLogger.collectCommunityProgress(
        discordMsgId, name, i + 1, newArticles.length,
        `Фільтрація: ${relevant.length} релевантних з ${i + 1}`,
      );
    }
  }

  console.log(`✅ [${slug}] Релевантних: ${relevant.length} з ${newArticles.length}`);

  // Спочатку — з фото, потім — без. Всередині кожної групи рандом.
  relevant.sort((a, b) => {
    const diff = (b.imageUrls?.length ?? 0) - (a.imageUrls?.length ?? 0);
    return diff !== 0 ? diff : Math.random() - 0.5;
  });

  // ─── Фаза 2: Переклад і валідація фото — поки не набереться limit ──────────
  const topArticles = [];

  for (const article of relevant) {
    if (topArticles.length >= limit) break;

    const { title, summary, url, imageUrls: rawUrls = [], source, lang } = article;

    let finalTitle   = title;
    let finalSummary = summary;

    if (lang === 'en') {
      try {
        const translated = await GeminiService.translateArticle(title, summary);
        finalTitle   = translated.title;
        finalSummary = translated.summary;
      } catch (err) {
        console.warn(`⚠️  [${slug}] Переклад: ${err.message} — пропускаємо`);
        continue;
      }
    }

    const validated = rawUrls.length
      ? (await Promise.all(rawUrls.map(u => validateAndCache(u)))).filter(Boolean)
      : [];

    if (rawUrls.length && validated.length < rawUrls.length) {
      console.log(`  🔍 [${slug}] Відхилено ${rawUrls.length - validated.length} нерелевантних фото`);
    }

    topArticles.push({
      id:           `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title:        finalTitle,
      summary:      finalSummary,
      url,
      imageUrl:     validated[0]?.url || null,
      imageUrls:    validated.map(v => v.url),
      imagePaths:   validated.map(v => v.cachePath),
      source,
      used:         false,
      collected_at: new Date().toISOString(),
    });
  }

  const updated     = [...fresh, ...topArticles];
  writeCommunityQueue(slug, updated);

  const unusedCount = updated.filter(a => !a.used).length;
  console.log(`✅ [collect:${slug}] Додано ${topArticles.length}. У черзі: ${unusedCount}`);

  await DiscordLogger.collectCommunityFinished(discordMsgId, name, topArticles.length, unusedCount);
}

/**
 * Збирає статті для всіх переданих спільнот послідовно.
 */
export async function collectAllCommunities(communities) {
  for (const community of communities) {
    try {
      await collectCommunityArticles(community);
    } catch (err) {
      console.error(`❌ [collect:${community.slug}]: ${err.message}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { getCommunities } = await import('../config.js');
  const communities = getCommunities();
  if (!communities.length) {
    console.error('❌ Немає спільнот у communities.json / COMMUNITIES_JSON');
    process.exit(1);
  }
  collectAllCommunities(communities).catch(console.error);
}
