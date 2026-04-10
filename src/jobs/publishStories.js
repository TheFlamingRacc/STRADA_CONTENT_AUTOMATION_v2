import { fileURLToPath } from 'url';
import AuthService from '../services/AuthService.js';
import StoryService from '../services/StoryService.js';
import GeminiService from '../services/GeminiService.js';
import { readInventedTopics } from '../utils/dataStore.js';
import { STORIES } from '../config.js';
import { sleepRandom } from '../utils/timeUtils.js';
import DiscordLogger from '../utils/DiscordLogger.js';

const STORY_TOPICS = [
  'що думаю про сучасні авто',
  'улюблена дорога для поїздки',
  'найкраща машина для міста',
  'моє ставлення до електромобілів',
  'що дратує в інших водіях',
  'ідеальний автозвук',
  'зима vs літо на дорозі',
  'перша машина — спогади',
];

export async function publishStories(users = []) {
  if (!STORIES.enabled) {
    console.log('ℹ️  Stories вимкнено (STORIES_ENABLED=false)');
    return;
  }

  const count = Math.floor(Math.random() * (STORIES.perDayMax - STORIES.perDayMin + 1)) + STORIES.perDayMin;
  console.log(`\n📖 [stories] Публікуємо ${count} stories...`);

  // Беремо рандомних юзерів
  const selectedUsers = [...users]
    .sort(() => 0.5 - Math.random())
    .slice(0, count);

  const inventedTopics = readInventedTopics();
  const allTopics      = [...STORY_TOPICS, ...inventedTopics.slice(0, 20)];
  let published        = 0;

  for (const user of selectedUsers) {
    try {
      const topic = allTopics[Math.floor(Math.random() * allTopics.length)];
      const text  = await GeminiService.generateStory(user, topic);

      const { token } = await AuthService.login(user.email, user.password);
      const uuid      = await StoryService.publishStory(token, text);

      console.log(`  ✓ Story від ${user.character_name}: ${text.slice(0, 60)}...`);
      published++;

      await sleepRandom(5000, 15000);
    } catch (err) {
      console.warn(`⚠️  Story (${user.character_name}): ${err.message}`);
    }
  }

  console.log(`✅ [stories] Опубліковано: ${published}`);
  if (published > 0) {
    await DiscordLogger.info('📖 Stories опубліковано', `Кількість: ${published}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishStories().catch(console.error);
}
