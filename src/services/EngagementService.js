import PostService from './PostService.js';
import StoryService from './StoryService.js';
import AuthService from './AuthService.js';
import { ENGAGEMENT } from '../config.js';
import { sleepRandom } from '../utils/timeUtils.js';
import DiscordLogger from '../utils/DiscordLogger.js';

const FEED_PER_PAGE = 21;

export default class EngagementService {
  /**
   * Завантажує ВСІ сторінки стрічки /feed/all.
   * Повертає масив унікальних постів (type === "post").
   */
  static async #fetchAllFeedPosts(token) {
    const seen  = new Set();
    const posts = [];
    let page = 1;

    while (true) {
      let items, totalPages;
      try {
        ({ items, totalPages } = await PostService.getFeedPage(token, page, FEED_PER_PAGE));
      } catch (err) {
        console.warn(`⚠️  Стрічка сторінка ${page}: ${err.message}`);
        break;
      }

      for (const item of items) {
        if (item.type !== 'post') continue;
        const uuid = item.data?.uuid;
        if (!uuid || seen.has(uuid)) continue;
        seen.add(uuid);
        posts.push(item.data);
      }

      if (page >= totalPages) break;
      page++;
    }

    return posts;
  }

  /**
   * Одна взаємодія від імені юзера: лайк або збереження.
   * Завантажує всі сторінки стрічки, обирає рандомний пост, виконує дію.
   *
   * @param {object}  user   — об'єкт юзера з users.json
   * @param {boolean} isTest — якщо true, не відправляє Discord per-interaction
   * @returns {{ likes: number, saves: number, interactions: Array }}
   */
  static async runForUser(user, isTest = false) {
    const { token } = await AuthService.login(user.email, user.password);

    const allPosts = await EngagementService.#fetchAllFeedPosts(token);
    if (!allPosts.length) {
      console.warn(`⚠️  [${user.character_name}] Стрічка порожня`);
      AuthService.clearToken(user.email);
      return { likes: 0, saves: 0, interactions: [] };
    }

    // Вибираємо дію; якщо немає кандидатів — пробуємо протилежну
    let doSave = Math.random() < ENGAGEMENT.saveChance;
    let candidates = doSave
      ? allPosts.filter(p => !p.saved_post)
      : allPosts.filter(p => !p.is_liked);

    if (!candidates.length) {
      doSave     = !doSave;
      candidates = doSave
        ? allPosts.filter(p => !p.saved_post)
        : allPosts.filter(p => !p.is_liked);
    }

    if (!candidates.length) {
      console.warn(`⚠️  [${user.character_name}] Всі доступні пости вже оброблено`);
      AuthService.clearToken(user.email);
      return { likes: 0, saves: 0, interactions: [] };
    }

    const post   = candidates[Math.floor(Math.random() * candidates.length)];
    const action = doSave ? 'save' : 'like';

    let likes = 0;
    let saves = 0;

    try {
      if (doSave) {
        await PostService.savePost(token, post.uuid);
        saves++;
      } else {
        await PostService.likePost(token, post.uuid);
        likes++;
      }

      const emoji = doSave ? '💾' : '❤️';
      console.log(`  ${emoji} ${user.character_name} → ${post.uuid}`);

      if (!isTest) {
        await DiscordLogger.engagementInteraction(user.character_name, action, post.uuid);
      }
    } catch (err) {
      console.warn(`⚠️  Engagement помилка (${user.character_name}): ${err.message}`);
    }

    AuthService.clearToken(user.email);
    return { likes, saves, interactions: likes + saves > 0 ? [{ action, uuid: post.uuid }] : [] };
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

      AuthService.clearToken(user.email);
      return stories.length;
    } catch (err) {
      console.warn(`⚠️  viewStories помилка (${user.character_name}): ${err.message}`);
      return 0;
    }
  }

  /**
   * Одна engagement-сесія — один рандомний юзер, одна взаємодія.
   */
  static async runForAll(users) {
    if (!ENGAGEMENT.enabled) {
      console.log('ℹ️  Engagement вимкнено (ENGAGEMENT_ENABLED=false)');
      return;
    }

    const user = users[Math.floor(Math.random() * users.length)];
    console.log(`\n👍 [engagement] ${user.character_name}`);

    const { likes, saves } = await EngagementService.runForUser(user, false);
    console.log(`✅ [engagement] ${likes ? '❤️ лайк' : saves ? '💾 збереження' : 'нічого'}`);
  }
}
