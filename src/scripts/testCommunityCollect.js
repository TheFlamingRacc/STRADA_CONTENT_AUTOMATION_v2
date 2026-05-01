import 'dotenv/config';

import { getCommunities } from '../config.js';
import { collectCommunityArticles } from '../jobs/collectCommunityArticles.js';
import { readCommunityQueue } from '../utils/dataStore.js';
import DiscordLogger from '../utils/DiscordLogger.js';

// CLI: npm run test-community-collect -- formula 10
// Перший аргумент — slug спільноти (або "all"), другий — ліміт
const slugArg  = process.argv[2] || 'all';
const limitArg = parseInt(process.argv[3]);

async function runTestCommunityCollect() {
  const communities = getCommunities();

  if (!communities.length) {
    console.error('❌ Немає спільнот у communities.json / COMMUNITIES_JSON');
    process.exit(1);
  }

  const targets = slugArg === 'all'
    ? communities
    : communities.filter(c => c.slug === slugArg);

  if (!targets.length) {
    console.error(`❌ Спільноту "${slugArg}" не знайдено. Доступні: ${communities.map(c => c.slug).join(', ')}`);
    process.exit(1);
  }

  console.log('─'.repeat(50));
  console.log(`🧪 TEST COMMUNITY COLLECT: ${targets.map(c => c.name).join(', ')}`);
  if (!isNaN(limitArg) && limitArg > 0) console.log(`   Ліміт: ${limitArg} статей`);
  console.log('─'.repeat(50));

  await DiscordLogger.warn(
    '🧪 Тестовий збір [спільноти]',
    targets.map(c => `• **${c.name}**`).join('\n'),
  );

  for (const community of targets) {
    const slug        = community.slug;
    const beforeCount = readCommunityQueue(slug).filter(a => !a.used).length;

    // Якщо передано ліміт — тимчасово перебиваємо налаштування
    const patchedCommunity = !isNaN(limitArg) && limitArg > 0
      ? { ...community, posts_per_day_max: Math.ceil(limitArg / 2) }
      : community;

    await collectCommunityArticles(patchedCommunity);

    const queue      = readCommunityQueue(slug);
    const afterCount = queue.filter(a => !a.used).length;
    const added      = afterCount - beforeCount;

    console.log('\n' + '═'.repeat(50));
    console.log(`📦 [${community.name}] До: ${beforeCount} | Після: ${afterCount} | Додано: ${added}`);
    console.log('─'.repeat(50));

    const fresh = queue
      .filter(a => !a.used)
      .slice(-Math.max(added, 0))
      .slice(-15);

    for (const a of fresh) {
      const imgCount = a.imageUrls?.length ?? (a.imageUrl ? 1 : 0);
      const imgMark  = imgCount > 1 ? `🖼️ ×${imgCount}` : imgCount === 1 ? '🖼️' : '—';
      console.log(`  ${imgMark}  ${a.title.slice(0, 70)}`);
    }
    console.log('═'.repeat(50));
  }
}

runTestCommunityCollect().catch(err => {
  console.error('💥 Критична помилка:', err);
  process.exit(1);
});
