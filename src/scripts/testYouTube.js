import { getUsers } from '../config.js';
import { publishYouTubePost } from '../jobs/publishYouTube.js';
import DiscordLogger from '../utils/DiscordLogger.js';

const cliArg = parseInt(process.argv[2]);
const count  = !isNaN(cliArg) && cliArg > 0 ? cliArg : 3;

async function runTestYouTube() {
  console.log('─'.repeat(50));
  console.log(`🧪 TEST MODE: публікуємо ${count} YouTube пост(ів) без затримок`);
  console.log('─'.repeat(50));

  const discordMsgId = await DiscordLogger.testYouTubeStarted(count);

  const users = getUsers();
  if (!users.length) {
    console.error('❌ Немає юзерів. Перевір USERS_JSON або data/users.json');
    process.exit(1);
  }

  console.log(`👥 Юзерів у пулі: ${users.length}`);

  let success = 0;
  let failed  = 0;

  for (let i = 1; i <= count; i++) {
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`🎬 YouTube пост ${i} / ${count}`);
    console.log('─'.repeat(40));

    const result = await publishYouTubePost(users, null);

    if (result) {
      success++;
      await DiscordLogger.testYouTubeProgress(
        discordMsgId,
        success,
        count,
        result.user.character_name,
        result.video.title,
      );
    } else {
      failed++;
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ Тест завершено: ${success} успішно, ${failed} помилок`);
  console.log('═'.repeat(50));

  await DiscordLogger.testYouTubeFinished(discordMsgId, count, success, failed);
}

runTestYouTube().catch(err => {
  console.error('💥 Критична помилка:', err);
  process.exit(1);
});
