import { getUsers } from '../config.js';
import { publishStories } from '../jobs/publishStories.js';

async function runTestStories() {
  console.log('─'.repeat(50));
  console.log('🧪 TEST MODE: публікуємо stories');
  console.log('─'.repeat(50));

  const users = getUsers();
  if (!users.length) {
    console.error('❌ Немає юзерів. Перевір USERS_JSON або data/users.json');
    process.exit(1);
  }

  console.log(`👥 Юзерів у пулі: ${users.length}`);
  await publishStories(users);

  console.log('\n' + '═'.repeat(50));
  console.log('✅ Тест stories завершено');
  console.log('═'.repeat(50));
}

runTestStories().catch(err => {
  console.error('💥 Критична помилка:', err);
  process.exit(1);
});
