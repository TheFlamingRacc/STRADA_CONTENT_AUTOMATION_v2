import PostService from './PostService.js';
import StoryService from './StoryService.js';
import AuthService from './AuthService.js';
import { ENGAGEMENT } from '../config.js';
import { sleepRandom } from '../utils/timeUtils.js';
import DiscordLogger from '../utils/DiscordLogger.js';

export default class EngagementService {
  /**
   * Основний цикл engagement для одного юзера:
   * лайкає і зберігає рандомні пости зі стрічки.
   *
   * @param {object} user — об'єкт юзера з users.json
   * @returns {{ likes: number, saves: number }}
   */
  static async runForUser(user) {
    const { token } = await AuthService.login(user.email, user.password);
    const posts = await PostService.getRecentPosts(token, 30);

    // Перемішуємо і беремо ліміт
    const targets = posts
      .sort(() => 0.5 - Math.random())
      .slice(0, ENGAGEMENT.likesPerRun);

    let likes = 0;
    let saves = 0;

    for (const post of targets) {
      try {
        await PostService.likePost(token, post.uuid);
        likes++;

        // Із шансом зберігаємо
        if (Math.random() < ENGAGEMENT.saveChance) {
          await PostService.savePost(token, post.uuid);
          saves++;
        }

        // Пауза між діями — виглядає природно
        await sleepRandom(ENGAGEMENT.delayMinMs, ENGAGEMENT.delayMaxMs);
      } catch (err) {
        console.warn(`⚠️  Engagement помилка (${user.character_name}): ${err.message}`);
      }
    }

    return { likes, saves };
  }

  /**
   * Переглядає активні stories від імені юзера.
   */
  static async viewStoriesForUser(user) {
    try {
      const { token } = await AuthService.login(user.email, user.password);
      const stories = await StoryService.getActiveStories(token, 10);

      for (const story of stories) {
        await StoryService.viewStory(token, story.uuid);
        await sleepRandom(1000, 3000);
      }

      return stories.length;
    } catch (err) {
      console.warn(`⚠️  viewStories помилка (${user.character_name}): ${err.message}`);
      return 0;
    }
  }

  /**
   * Запускає engagement для масиву юзерів.
   * Логує результат у Discord.
   */
  static async runForAll(users) {
    if (!ENGAGEMENT.enabled) {
      console.log('ℹ️  Engagement вимкнено (ENGAGEMENT_ENABLED=false)');
      return;
    }

    console.log(`\n👍 [engagement] Запуск для ${users.length} юзерів...`);

    let totalLikes = 0;
    let totalSaves = 0;

    // Беремо рандомну підмножину юзерів щоразу (не всі одночасно)
    const activeUsers = users
      .sort(() => 0.5 - Math.random())
      .slice(0, Math.ceil(users.length / 2));

    for (const user of activeUsers) {
      const { likes, saves } = await EngagementService.runForUser(user);
      console.log(`  ✓ ${user.character_name}: +${likes} лайків, +${saves} збережень`);
      totalLikes += likes;
      totalSaves += saves;

      await sleepRandom(ENGAGEMENT.delayMinMs * 2, ENGAGEMENT.delayMaxMs * 2);
    }

    console.log(`✅ [engagement] Готово: ${totalLikes} лайків, ${totalSaves} збережень`);
    await DiscordLogger.engagementDone(totalLikes, totalSaves);
  }
}
