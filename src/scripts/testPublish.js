// Завантажує .env для локального запуску (Railway ігнорує, якщо файлу немає)
import 'dotenv/config';

import { TEST, getUsers } from '../config.js';
import { collectArticles } from '../jobs/collectArticles.js';
import { publishPosts } from '../jobs/publishPosts.js';
import { hasUnusedArticles } from '../utils/dataStore.js';
import DiscordLogger from '../utils/DiscordLogger.js';

// CLI аргумент має пріоритет над env/конфігом: npm run test-publish -- 5
const cliArg = parseInt(process.argv[2]);
const count  = !isNaN(cliArg) && cliArg > 0 ? cliArg : TEST.postsCount;

async function runTestPublish() {
  console.log('─'.repeat(50));
  console.log(`🧪 TEST MODE: публікуємо ${count} пост(ів) без затримок`);
  console.log('─'.repeat(50));

  // Початкове Discord-повідомлення з прогрес-баром (зберігаємо ID для редагування)
  const discordMsgId = await DiscordLogger.testPublishStarted(count);

  const users = getUsers();
  if (!users.length) {
    console.error('❌ Немає юзерів. Перевір USERS_JSON або data/users.json');
    process.exit(1);
  }

  console.log(`👥 Юзерів у пулі: ${users.length}`);

  // Збір статей якщо черга порожня
  if (!hasUnusedArticles()) {
    console.log('\n🔄 Черга порожня — збираємо статті...');
    await collectArticles();
  } else {
    console.log('📦 У черзі є статті, використовуємо їх');
  }

  let success = 0;
  let failed  = 0;

  for (let i = 1; i <= count; i++) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`📤 Пост ${i} / ${count}`);
    console.log('─'.repeat(40));

    const result = await publishPosts(null, users, null);

    if (result) {
      success++;
      await DiscordLogger.testPublishProgress(
        discordMsgId,
        success,
        count,
        result.user.character_name,
        result.article.title,
      );
    } else {
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ Тест завершено: ${success} успішно, ${failed} помилок`);
  console.log('═'.repeat(50));

  await DiscordLogger.testPublishFinished(discordMsgId, count, success, failed);
}

runTestPublish().catch(err => {
  console.error('💥 Критична помилка:', err);
  process.exit(1);
});
