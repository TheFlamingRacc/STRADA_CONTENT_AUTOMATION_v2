import { fileURLToPath } from 'url';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import fetch from 'node-fetch';
import sizeOf from 'image-size';
import RssService from '../services/RssService.js';
import GeminiService from '../services/GeminiService.js';
import { readQueue, writeQueue, updateState, readInventedTopics } from '../utils/dataStore.js';
import { CONTENT, DATA_DIR } from '../config.js';
import DiscordLogger from '../utils/DiscordLogger.js';

const WEEK_MS     = 7 * 24 * 60 * 60 * 1000;
const IMG_CACHE   = path.join(DATA_DIR, 'img_cache');

/**
 * Завантажує зображення, перевіряє (розмір, пікселі, Vision) і кешує на диск.
 * Повертає { url, cachePath } якщо фото підходить, або null — якщо треба відкинути.
 * При мережевій помилці повертає { url, cachePath: null } — не відкидаємо, але кешу немає.
 */
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
    // Мережева помилка — не відкидаємо, але кеш недоступний
    return { url: imageUrl, cachePath: null };
  }

  // Зберігаємо буфер на диск — щоб при публікації не завантажувати повторно
  try {
    mkdirSync(IMG_CACHE, { recursive: true });
    const ext      = contentType.split('/')[1] || 'jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const cachePath = path.join(IMG_CACHE, filename);
    writeFileSync(cachePath, buffer);
    return { url: imageUrl, cachePath };
  } catch {
    return { url: imageUrl, cachePath: null };
  }
}

/**
 * @param {number|null} limitOverride — якщо передано, перекриває MAX_NEW_ARTICLES з конфігу
 */
export async function collectArticles(limitOverride = null) {
  const limit = limitOverride ?? CONTENT.maxNewArticles;
  console.log(`\n🔍 [collect] Починаємо збір (ліміт: ${limit})...`);

  // Надсилаємо початкове повідомлення і зберігаємо ID для редагування
  const discordMsgId = await DiscordLogger.collectStarted(limit);

  const existing = readQueue();

  // Прибираємо старі використані статті (старше тижня)
  const fresh = existing.filter(
    a => !a.used || new Date(a.collected_at).getTime() > Date.now() - WEEK_MS
  );

  const existingUrls   = new Set(existing.map(a => a.url).filter(Boolean));
  const existingTitles = new Set(existing.map(a => a.title).filter(Boolean));
  const processed      = [];

  // ─── 1. RSS статті ──────────────────────────────────────────────────────────
  const articles = await RssService.fetchAll();
  console.log(`📰 RSS: знайдено ${articles.length} статей`);

  for (const article of articles) {
    if (processed.length >= limit) break;

    const { title, summary, url, imageUrl, imageUrls, source, lang } = article;

    if (existingUrls.has(url) || processed.some(p => p.url === url)) continue;

    // Фільтр тематики
    let isAuto = false;
    try {
      isAuto = await GeminiService.isAutoRelated(title, summary);
    } catch (err) {
      console.warn(`⚠️  Аналіз тематики: ${err.message}`);
      continue;
    }

    if (!isAuto) {
      console.log(`⏭️  Не про авто: ${title.slice(0, 50)}`);
      continue;
    }

    // Переклад
    let finalTitle   = title;
    let finalSummary = summary;

    if (lang === 'en') {
      try {
        const translated = await GeminiService.translateArticle(title, summary);
        finalTitle   = translated.title;
        finalSummary = translated.summary;
      } catch (err) {
        console.warn(`⚠️  Переклад: ${err.message} — пропускаємо`);
        continue;
      }
    }

    // Завантажуємо, перевіряємо і кешуємо фото (один раз — при зборі)
    const rawUrls    = imageUrls || [];
    const validated  = rawUrls.length
      ? (await Promise.all(rawUrls.map(u => validateAndCache(u)))).filter(Boolean)
      : [];

    if (rawUrls.length && validated.length < rawUrls.length) {
      console.log(`  🔍 Відхилено ${rawUrls.length - validated.length} нерелевантних фото`);
    }

    const checkedImageUrls  = validated.map(v => v.url);
    const checkedImagePaths = validated.map(v => v.cachePath); // null якщо кеш не вдався

    processed.push({
      id:           `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title:        finalTitle,
      summary:      finalSummary,
      url,
      imageUrl:     checkedImageUrls[0] || null,
      imageUrls:    checkedImageUrls,
      imagePaths:   checkedImagePaths,
      source,
      used:         false,
      collected_at: new Date().toISOString(),
    });

    console.log(`  ✓ ${finalTitle.slice(0, 60)}`);

    // Оновлюємо прогрес у Discord (редагуємо початкове повідомлення)
    await DiscordLogger.collectProgress(discordMsgId, processed.length, limit, finalTitle);
  }

  // ─── 2. Вигадані теми (якщо не добрали ліміт) ──────────────────────────────
  if (processed.length < limit) {
    const topics    = readInventedTopics();
    const spaceLeft = limit - processed.length;

    for (let i = 0; i < spaceLeft; i++) {
      if (Math.random() > CONTENT.inventedTopicChance) continue;

      const topic = topics[Math.floor(Math.random() * topics.length)];
      if (!topic) continue;
      if (existingTitles.has(topic) || processed.some(p => p.title === topic)) continue;

      processed.push({
        id:           `inv-${Date.now()}-${i}`,
        title:        topic,
        summary:      '',
        source:       'invented',
        used:         false,
        collected_at: new Date().toISOString(),
      });
    }
  }

  const updated = [...fresh, ...processed];
  writeQueue(updated);
  updateState({ last_collect: new Date().toISOString() });

  const unusedCount = updated.filter(a => !a.used).length;
  console.log(`✅ [collect] Додано ${processed.length}. У черзі готових: ${unusedCount}`);

  // Фінальне редагування повідомлення з підсумком
  await DiscordLogger.collectFinished(discordMsgId, processed.length, unusedCount);
}

// Пряме виконання: node src/jobs/collectArticles.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  collectArticles().catch(console.error);
}
