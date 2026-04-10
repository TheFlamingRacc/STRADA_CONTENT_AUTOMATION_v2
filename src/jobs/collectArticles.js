import { fileURLToPath } from 'url';
import RssService from '../services/RssService.js';
import GeminiService from '../services/GeminiService.js';
import { readQueue, writeQueue, updateState, readInventedTopics } from '../utils/dataStore.js';
import { CONTENT } from '../config.js';
import DiscordLogger from '../utils/DiscordLogger.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function collectArticles() {
  console.log(`\n🔍 [collect] Починаємо збір (ліміт: ${CONTENT.maxNewArticles})...`);

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
    if (processed.length >= CONTENT.maxNewArticles) break;

    const { title, summary, url, imageUrl, source, lang } = article;

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

    processed.push({
      id:           `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title:        finalTitle,
      summary:      finalSummary,
      url,
      imageUrl:     imageUrl || null,
      source,
      used:         false,
      collected_at: new Date().toISOString(),
    });

    console.log(`  ✓ ${finalTitle.slice(0, 60)}`);
  }

  // ─── 2. Вигадані теми (якщо не добрали ліміт) ──────────────────────────────
  if (processed.length < CONTENT.maxNewArticles) {
    const topics    = readInventedTopics();
    const spaceLeft = CONTENT.maxNewArticles - processed.length;

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

  await DiscordLogger.collectDone(processed.length, unusedCount);
}

// Пряме виконання: node src/jobs/collectArticles.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  collectArticles().catch(console.error);
}
