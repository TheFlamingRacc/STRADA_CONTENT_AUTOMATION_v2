import PostService from './PostService.js';
import StoryService from './StoryService.js';
import AuthService from './AuthService.js';
import { ENGAGEMENT, LISTING_ENGAGEMENT } from '../config.js';
import { sleepRandom } from '../utils/timeUtils.js';
import DiscordLogger from '../utils/DiscordLogger.js';

export default class EngagementService {
  /**
   * Завантажує до ENGAGEMENT.feedPages сторінок стрічки /feed/all.
   * Повертає масив унікальних постів (type === "post").
   */
  static async #fetchFeedPosts(token) {
    const seen  = new Set();
    const posts = [];

    for (let page = 1; page <= ENGAGEMENT.feedPages; page++) {
      let items, totalPages;
      try {
        ({ items, totalPages } = await PostService.getFeedPage(token, page, ENGAGEMENT.feedPerPage));
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
  static async runForUser(user, isTest = false, nextSlotTime = null) {
    const { token } = await AuthService.login(user.email, user.password);

    const allPosts = await EngagementService.#fetchFeedPosts(token);
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
        await DiscordLogger.engagementInteraction(user.character_name, action, post.uuid, nextSlotTime);
      }
    } catch (err) {
      console.warn(`⚠️  Engagement помилка (${user.character_name}): ${err.message}`);
    }

    // Після основної взаємодії — переглядаємо і лайкаємо stories
    await EngagementService.#engageWithStories(token, user);

    AuthService.clearToken(user.email);
    return { likes, saves, interactions: likes + saves > 0 ? [{ action, uuid: post.uuid }] : [] };
  }

  /**
   * Переглядає до 5 непереглянутих stories, лайкає з шансом 25%.
   */
  static async #engageWithStories(token, user) {
    try {
      const stories  = await StoryService.getActiveStories(token, 20);
      const unviewed = stories.filter(s => !s.is_viewed).slice(0, 5);
      if (!unviewed.length) return;

      let viewed = 0;
      let liked  = 0;

      for (const story of unviewed) {
        await StoryService.viewStory(token, story.uuid);
        viewed++;

        if (Math.random() < 0.25) {
          try {
            await StoryService.likeStory(token, story.uuid);
            liked++;
          } catch {}
        }

        await sleepRandom(800, 2500);
      }

      console.log(`  👁  ${user.character_name} stories: ${viewed} переглянуто${liked ? `, ${liked} лайк` : ''}`);
    } catch (err) {
      console.warn(`⚠️  Story engagement (${user.character_name}): ${err.message}`);
    }
  }

  /**
   * Одна engagement-сесія — один рандомний юзер, одна взаємодія.
   */
  static async runForAll(users, nextSlotTime = null) {
    if (!ENGAGEMENT.enabled) {
      console.log('ℹ️  Engagement вимкнено (ENGAGEMENT_ENABLED=false)');
      return;
    }

    const user = users[Math.floor(Math.random() * users.length)];
    console.log(`\n👍 [engagement] ${user.character_name}`);

    const { likes, saves } = await EngagementService.runForUser(user, false, nextSlotTime);
    console.log(`✅ [engagement] ${likes ? '❤️ лайк' : saves ? '💾 збереження' : 'нічого'}`);
  }

  // ─── ЛАЙКИ ОГОЛОШЕНЬ (каталог) ──────────────────────────────────────────────

  /**
   * Завантажує до LISTING_ENGAGEMENT.feedPages сторінок каталогу /catalog.
   * Повертає масив унікальних оголошень.
   */
  static async #fetchCatalogListings(token) {
    const seen     = new Set();
    const listings = [];

    for (let page = 1; page <= LISTING_ENGAGEMENT.feedPages; page++) {
      let items, totalPages;
      try {
        ({ items, totalPages } = await PostService.getCatalogPage(token, page, LISTING_ENGAGEMENT.feedPerPage));
      } catch (err) {
        console.warn(`⚠️  Каталог сторінка ${page}: ${err.message}`);
        break;
      }

      for (const item of items) {
        const uuid = item?.uuid;
        if (!uuid || seen.has(uuid)) continue;
        seen.add(uuid);
        listings.push(item);
      }

      if (page >= totalPages) break;
    }

    return listings;
  }

  /**
   * Читабельна назва оголошення: "Dodge Challenger 2020".
   */
  static #listingLabel(listing) {
    return [listing.brand?.name, listing.serie?.name, listing.year]
      .filter(Boolean)
      .join(' ') || 'оголошення';
  }

  /**
   * Один лайк оголошення від імені юзера (toggle збереження в обране).
   * Обирає рандомне ще НЕ збережене й не власне оголошення з каталогу.
   *
   * @param {object}  user   — об'єкт юзера з users.json
   * @param {boolean} isTest — якщо true, не відправляє Discord per-interaction
   * @returns {{ saved: number, interactions: Array }}
   */
  static async runListingLikeForUser(user, isTest = false, nextSlotTime = null) {
    const { token } = await AuthService.login(user.email, user.password);

    const all = await EngagementService.#fetchCatalogListings(token);
    if (!all.length) {
      console.warn(`⚠️  [${user.character_name}] Каталог порожній`);
      AuthService.clearToken(user.email);
      return { saved: 0, interactions: [] };
    }

    // Тільки ще не збережені (toggle двічі зняв би лайк) і не власні оголошення
    const candidates = all.filter(l => !l.saved && l.user?.username !== user.username);
    if (!candidates.length) {
      console.warn(`⚠️  [${user.character_name}] Немає нових оголошень для лайку`);
      AuthService.clearToken(user.email);
      return { saved: 0, interactions: [] };
    }

    const listing = candidates[Math.floor(Math.random() * candidates.length)];
    const label   = EngagementService.#listingLabel(listing);

    let saved = 0;
    try {
      await PostService.toggleSaveListing(token, listing.uuid);
      saved++;
      console.log(`  🚗❤️ ${user.character_name} → ${label} (${listing.uuid})`);

      if (!isTest) {
        await DiscordLogger.listingLike(user.character_name, label, listing.uuid, nextSlotTime);
      }
    } catch (err) {
      console.warn(`⚠️  Лайк оголошення помилка (${user.character_name}): ${err.message}`);
    }

    AuthService.clearToken(user.email);
    return { saved, interactions: saved > 0 ? [{ uuid: listing.uuid, label }] : [] };
  }

  /**
   * Одна сесія лайку оголошень — один рандомний юзер, одне оголошення.
   */
  static async runListingLikeForAll(users, nextSlotTime = null) {
    if (!LISTING_ENGAGEMENT.enabled) {
      console.log('ℹ️  Лайки оголошень вимкнено (LISTING_LIKES_ENABLED=false)');
      return;
    }

    const user = users[Math.floor(Math.random() * users.length)];
    console.log(`\n🚗 [listing-like] ${user.character_name}`);

    const { saved } = await EngagementService.runListingLikeForUser(user, false, nextSlotTime);
    console.log(`✅ [listing-like] ${saved ? '🚗❤️ збережено' : 'нічого'}`);
  }
}
