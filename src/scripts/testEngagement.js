import 'dotenv/config';

import { getUsers } from '../config.js';
import EngagementService from '../services/EngagementService.js';
import DiscordLogger from '../utils/DiscordLogger.js';

// CLI аргумент: npm run test-engagement -- 5  (кількість взаємодій)
const cliArg = parseInt(process.argv[2]);
const count  = !isNaN(cliArg) && cliArg > 0 ? cliArg : 3;

async function runTestEngagement() {
  console.log('─'.repeat(50));
  console.log(`🧪 TEST ENGAGEMENT: ${count} взаємодій`);
  console.log('─'.repeat(50));

  const allUsers = getUsers();
  if (!allUsers.length) {
    console.error('❌ Немає юзерів. Перевір USERS_JSON або data/users.json');
    process.exit(1);
  }

  console.log(`👥 Доступно юзерів: ${allUsers.length}`);

  const discordMsgId = await DiscordLogger.engagementTestStarted(count);

  // Перемішуємо юзерів і циклічно повторюємо якщо взаємодій більше ніж юзерів
  const shuffled = [...allUsers].sort(() => 0.5 - Math.random());

  let totalLikes = 0;
  let totalSaves = 0;
  let done       = 0;
  const log      = []; // накопичений список взаємодій для Discord

  for (let i = 0; i < count; i++) {
    const user = shuffled[i % shuffled.length];

    console.log(`\n${'─'.repeat(40)}`);
    console.log(`📤 Взаємодія ${i + 1} / ${count} — ${user.character_name}`);
    console.log('─'.repeat(40));

    const { likes, saves, interactions } = await EngagementService.runForUser(user, true);

    totalLikes += likes;
    totalSaves += saves;
    done++;

    const last = interactions.at(-1);
    if (last) {
      log.push({ characterName: user.character_name, action: last.action, uuid: last.uuid });
    }

    await DiscordLogger.engagementTestProgress(discordMsgId, done, count, log);

  }

  console.log('\n' + '═'.repeat(50));
  console.log(`✅ Тест завершено: ${totalLikes} лайків, ${totalSaves} збережень`);
  console.log('═'.repeat(50));

  await DiscordLogger.engagementTestFinished(discordMsgId, count, totalLikes, totalSaves);
}

runTestEngagement().catch(err => {
  console.error('💥 Критична помилка:', err);
  process.exit(1);
});
