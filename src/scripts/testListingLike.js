import 'dotenv/config';

import { getUsers } from '../config.js';
import EngagementService from '../services/EngagementService.js';
import DiscordLogger from '../utils/DiscordLogger.js';

// CLI аргумент: npm run test-listing -- 5  (кількість лайків оголошень)
const cliArg = parseInt(process.argv[2]);
const count  = !isNaN(cliArg) && cliArg > 0 ? cliArg : 3;

async function runTestListingLike() {
  console.log('─'.repeat(50));
  console.log(`🧪 TEST LISTING LIKE: ${count} лайків оголошень`);
  console.log('─'.repeat(50));

  const allUsers = getUsers();
  if (!allUsers.length) {
    console.error('❌ Немає юзерів. Перевір USERS_JSON або data/users.json');
    process.exit(1);
  }

  console.log(`👥 Доступно юзерів: ${allUsers.length}`);

  const discordMsgId = await DiscordLogger.listingTestStarted(count);

  // Перемішуємо юзерів і циклічно повторюємо якщо лайків більше ніж юзерів
  const shuffled = [...allUsers].sort(() => 0.5 - Math.random());

  let totalSaved = 0;
  let done       = 0;
  const log      = []; // накопичений список лайків для Discord

  for (let i = 0; i < count; i++) {
    const user = shuffled[i % shuffled.length];

    console.log(`\n${'─'.repeat(40)}`);
    console.log(`📤 Лайк ${i + 1} / ${count} — ${user.character_name}`);
    console.log('─'.repeat(40));

    const { saved, interactions } = await EngagementService.runListingLikeForUser(user, true);

    totalSaved += saved;
    done++;

    const last = interactions.at(-1);
    if (last) {
      log.push({ characterName: user.character_name, label: last.label });
    }

    await DiscordLogger.listingTestProgress(discordMsgId, done, count, log);
  }

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ Тест завершено: ${totalSaved} оголошень збережено`);
  console.log('═'.repeat(50));

  await DiscordLogger.listingTestFinished(discordMsgId, count, totalSaved);
}

runTestListingLike().catch(err => {
  console.error('💥 Критична помилка:', err);
  process.exit(1);
});
