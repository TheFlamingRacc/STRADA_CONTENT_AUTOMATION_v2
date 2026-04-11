import 'dotenv/config';

import { collectArticles } from '../jobs/collectArticles.js';
import { readQueue } from '../utils/dataStore.js';
import DiscordLogger from '../utils/DiscordLogger.js';

// CLI аргумент має пріоритет: npm run test-collect -- 10
const cliArg = parseInt(process.argv[2]);
const count  = !isNaN(cliArg) && cliArg > 0 ? cliArg : null; // null = бере MAX_NEW_ARTICLES

async function runTestCollect() {
  console.log('─'.repeat(50));
  console.log(`🧪 TEST COLLECT: збираємо${count ? ` до ${count}` : ''} статей`);
  console.log('─'.repeat(50));

  await DiscordLogger.warn(
    '🧪 Тестовий збір статей',
    count ? `Ліміт: ${count} статей` : 'Ліміт з конфігу (MAX_NEW_ARTICLES)',
  );

  const beforeCount = readQueue().filter(a => !a.used).length;

  await collectArticles(count);

  const queue      = readQueue();
  const afterCount = queue.filter(a => !a.used).length;
  const added      = afterCount - beforeCount;

  // Показуємо зібране
  console.log('\n' + '═'.repeat(50));
  console.log(`📦 У черзі до збору: ${beforeCount} | після: ${afterCount} | додано: ${added}`);
  console.log('─'.repeat(50));

  const fresh = queue
    .filter(a => !a.used)
    .slice(-Math.max(added, 0))
    .slice(-20); // показуємо останні 20

  for (const a of fresh) {
    const imgCount = a.imageUrls?.length ?? (a.imageUrl ? 1 : 0);
    const imgMark  = imgCount > 1 ? `🖼️ ×${imgCount}` : imgCount === 1 ? '🖼️' : '—';
    console.log(`  ${imgMark}  ${a.title.slice(0, 70)}`);
  }

  console.log('═'.repeat(50));
}

runTestCollect().catch(err => {
  console.error('💥 Критична помилка:', err);
  process.exit(1);
});
