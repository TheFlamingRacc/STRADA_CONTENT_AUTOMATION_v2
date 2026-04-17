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

const WEEK_MS   = 7 * 24 * 60 * 60 * 1000;
const IMG_CACHE = path.join(DATA_DIR, 'img_cache');

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
 * @param {number|null} limitOverride — якщо передано, перекриває MAX_NEW_ARTICLES з конфігу
 */
export async function collectArticles(limitOverride = null) {
  const limit = limitOverride ?? CONTENT.maxNewArticles;
  console.log(`\n🔍 [collect] Починаємо збір (ліміт: ${limit})...`);

  const discordMsgId = await DiscordLogger.collectStarted(limit);

  const existing = readQueue();

  // Прибираємо старі використані статті (старше тижня)
  const fresh = existing.filter(
    a => !a.used || new Date(a.collected_at).getTime() > Date.now() - WEEK_MS,
  );

  const existingUrls   = new Set(existing.map(a => a.url).filter(Boolean));
  const existingTitles = new Set(existing.map(a => a.title).filter(Boolean));

  // ─── Фаза 1: Завантаження всіх RSS і швидка фільтрація ─────────────────────
  const allArticles = await RssService.fetchAll();
  console.log(`📰 RSS: знайдено ${allArticles.length} статей`);

  // Прибираємо дублікати по URL
  const newArticles = allArticles.filter(
    a => a.url && !existingUrls.has(a.url),
  );
  console.log(`📰 Нових (без дублів): ${newArticles.length}`);

  // Перевіряємо тематику для ВСІХ нових статей
  console.log(`🤖 Перевіряємо тематику ${newArticles.length} статей...`);
  const autoRelated = [];

  for (const article of newArticles) {
    try {
      const isAuto = await GeminiService.isAutoRelated(article.title, article.summary);
      if (isAuto) {
        autoRelated.push(article);
      } else {
        console.log(`⏭️  Не про авто: ${article.title.slice(0, 50)}`);
      }
    } catch (err) {
      console.warn(`⚠️  Аналіз тематики: ${err.message}`);
    }
  }

  console.log(`✅ Авто-статей: ${autoRelated.length} з ${newArticles.length}`);

  // Сортуємо за кількістю raw imageUrls (більше фото — вищий пріоритет)
  // При рівній кількості — перемішуємо рандомно для різноманітності
  autoRelated.sort((a, b) => {
    const diff = (b.imageUrls?.length ?? 0) - (a.imageUrls?.length ?? 0);
    if (diff !== 0) return diff;
    return Math.random() - 0.5;
  });

  // Беремо кандидатів з буфером (×2) — деякі відпадуть після валідації фото
  const candidatePool = autoRelated.slice(0, limit * 2);
  console.log(`🎯 Кандидатів для обробки: ${candidatePool.length} (буфер ×2)`);

  // ─── Фаза 2: Переклад і валідація фото для кандидатів ──────────────────────
  const candidates = [];

  for (const article of candidatePool) {
    const { title, summary, url, imageUrls: rawUrls = [], source, lang } = article;

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
    const validated = rawUrls.length
      ? (await Promise.all(rawUrls.map(u => validateAndCache(u)))).filter(Boolean)
      : [];

    if (rawUrls.length && validated.length < rawUrls.length) {
      console.log(`  🔍 Відхилено ${rawUrls.length - validated.length} нерелевантних фото (${finalTitle.slice(0, 40)})`);
    }

    const checkedImageUrls  = validated.map(v => v.url);
    const checkedImagePaths = validated.map(v => v.cachePath);

    candidates.push({
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
      _imgCount:    checkedImageUrls.length, // тимчасове поле для сортування
    });
  }

  // ─── Фаза 3: Сортуємо за реальною кількістю фото і беремо топ limit ─────────
  candidates.sort((a, b) => {
    const diff = b._imgCount - a._imgCount;
    if (diff !== 0) return diff;
    return Math.random() - 0.5;
  });

  const topArticles = candidates.slice(0, limit);

  // Видаляємо тимчасове поле
  for (const a of topArticles) delete a._imgCount;

  // Логуємо результат
  console.log(`📊 Топ статей за фото:`);
  for (const a of topArticles) {
    console.log(`  🖼️  ${a.imageUrls.length} фото — ${a.title.slice(0, 55)}`);
  }

  // Discord прогрес
  for (let i = 0; i < topArticles.length; i++) {
    await DiscordLogger.collectProgress(discordMsgId, i + 1, topArticles.length, topArticles[i].title);
  }

  // ─── Фаза 4: Вигадані теми (якщо не добрали ліміт) ────────────────────────
  const inventedNeeded = limit - topArticles.length;
  const invented       = [];

  if (inventedNeeded > 0) {
    const topics    = readInventedTopics();
    const spaceLeft = inventedNeeded;

    for (let i = 0; i < spaceLeft * 3 && invented.length < spaceLeft; i++) {
      if (Math.random() > CONTENT.inventedTopicChance) continue;

      const topic = topics[Math.floor(Math.random() * topics.length)];
      if (!topic) continue;
      if (existingTitles.has(topic) || topArticles.some(p => p.title === topic) || invented.some(p => p.title === topic)) continue;

      invented.push({
        id:           `inv-${Date.now()}-${i}`,
        title:        topic,
        summary:      '',
        source:       'invented',
        used:         false,
        collected_at: new Date().toISOString(),
      });
    }
  }

  const processed = [...topArticles, ...invented];
  const updated   = [...fresh, ...processed];
  writeQueue(updated);
  updateState({ last_collect: new Date().toISOString() });

  const unusedCount = updated.filter(a => !a.used).length;
  console.log(`✅ [collect] Додано ${processed.length} (${topArticles.length} RSS + ${invented.length} вигаданих). У черзі: ${unusedCount}`);

  await DiscordLogger.collectFinished(discordMsgId, processed.length, unusedCount);
}

// Пряме виконання: node src/jobs/collectArticles.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  collectArticles().catch(console.error);
}
