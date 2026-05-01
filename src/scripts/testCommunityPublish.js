import 'dotenv/config';

import { getCommunities } from '../config.js';
import { collectCommunityArticles } from '../jobs/collectCommunityArticles.js';
import { publishCommunityPost } from '../jobs/publishCommunityPost.js';
import { hasUnusedCommunityArticles } from '../utils/dataStore.js';
import DiscordLogger from '../utils/DiscordLogger.js';

// CLI: npm run test-community-publish -- formula 3
//      npm run test-community-publish -- formula 3 youtube
// Аргументи: slug, кількість, тип (rss | youtube | random, за замовч. rss)
const slugArg  = process.argv[2];
const cliCount = parseInt(process.argv[3]);
const typeArg  = process.argv[4] ?? 'rss'; // rss | youtube | random
const count    = !isNaN(cliCount) && cliCount > 0 ? cliCount : 3;

async function runTestCommunityPublish() {
  const communities = getCommunities();

  if (!communities.length) {
    console.error('❌ Немає спільнот у communities.json / COMMUNITIES_JSON');
    process.exit(1);
  }

  const community = slugArg
    ? communities.find(c => c.slug === slugArg)
    : communities[0];

  if (!community) {
    const available = communities.map(c => `${c.slug} (${c.name})`).join('\n  ');
    console.error(`❌ Спільноту "${slugArg}" не знайдено.\nДоступні:\n  ${available}`);
    process.exit(1);
  }

  console.log('─'.repeat(50));
  console.log(`🧪 TEST COMMUNITY PUBLISH: ${community.name} — ${count} пост(ів)`);
  console.log('─'.repeat(50));

  const discordMsgId = await DiscordLogger.testCommunityPublishStarted(count, community.name);

  // Збір якщо черга порожня (потрібен для rss/random)
  if (typeArg !== 'youtube' && !hasUnusedCommunityArticles(community.slug)) {
    console.log('\n🔄 Черга порожня — збираємо статті...');
    await collectCommunityArticles(community);
  } else if (typeArg !== 'youtube') {
    console.log('📦 У черзі є статті, використовуємо їх');
  }

  const { YOUTUBE_POSTS } = await import('../config.js');

  let success = 0;
  let failed  = 0;

  for (let i = 1; i <= count; i++) {
    console.log(`\n${'─'.repeat(40)}`);

    const type = typeArg === 'random'
      ? (YOUTUBE_POSTS.enabled && Math.random() < YOUTUBE_POSTS.postChance ? 'youtube' : 'rss')
      : typeArg;

    console.log(`📤 Пост ${i} / ${count} [${community.name}] (${type})`);
    console.log('─'.repeat(40));

    const result = await publishCommunityPost(community, type, null);

    if (result) {
      success++;
      const label = result.video ? result.video.title : result.article?.title ?? '—';
      await DiscordLogger.testCommunityPublishProgress(discordMsgId, i, count, community.name, label);
    } else {
      failed++;
      await DiscordLogger.testCommunityPublishProgress(discordMsgId, i, count, community.name, '❌ помилка');
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ Тест завершено: ${success} успішно, ${failed} помилок`);
  console.log('═'.repeat(50));

  await DiscordLogger.testCommunityPublishFinished(discordMsgId, count, success, failed, community.name);
}

runTestCommunityPublish().catch(err => {
  console.error('💥 Критична помилка:', err);
  process.exit(1);
});
