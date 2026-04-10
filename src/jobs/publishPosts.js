import { fileURLToPath } from 'url';
import AuthService from '../services/AuthService.js';
import PostService from '../services/PostService.js';
import GeminiService from '../services/GeminiService.js';
import YouTubeService from '../services/YouTubeService.js';
import { readQueue, writeQueue, updateState } from '../utils/dataStore.js';
import UserProfiler from '../analytics/UserProfiler.js';
import { CONTENT, BASE_URL } from '../config.js';
import { sleep } from '../utils/timeUtils.js';
import DiscordLogger from '../utils/DiscordLogger.js';

/**
 * Знаходить наступну статтю для публікації.
 * Пріоритет: статті з фото.
 */
function findNextArticle(queue) {
  const withPhoto = queue.filter(a => !a.used && a.imageUrl);
  if (withPhoto.length > 0) {
    return withPhoto[Math.floor(Math.random() * withPhoto.length)];
  }
  return queue.find(a => !a.used) || null;
}

/**
 * Публікує один пост від обраного юзера.
 *
 * @param {number} limit     — скільки постів (дефолт 1)
 * @param {object|null} targetUser — конкретний юзер з розкладу або null (рандом)
 */
export async function publishPosts(limit = 1, targetUser = null, users = []) {
  console.log('\n🚀 [publish] Починаємо публікацію...');

  let queue = readQueue();

  const selected = targetUser
    ? [targetUser]
    : [users[Math.floor(Math.random() * users.length)]];

  const user = selected[0];
  if (!user) {
    console.error('❌ Немає юзерів для публікації');
    return;
  }

  console.log(`👤 Автор: ${user.character_name} (${user.username})`);

  // Вибір статті: спочатку пробуємо підібрати по профілю юзера
  const article = UserProfiler.findRelevantArticle(user, queue) || findNextArticle(queue);
  if (!article) {
    console.warn('⚠️  Черга порожня!');
    await DiscordLogger.warn('⚠️ Черга порожня', 'Немає статей для публікації');
    return;
  }

  try {
    console.log(`\n✍️  [${user.character_name}] ${article.title}`);

    const { token } = await AuthService.login(user.email, user.password);

    // Генерація контенту
    let content = await GeminiService.generatePost(article, user);

    // Вставка YouTube відео (з шансом)
    if (YouTubeService.enabled && Math.random() < CONTENT.youtubeInPostChance) {
      const video = await YouTubeService.findVideo(article.title);
      if (video) {
        content += `\n${YouTubeService.videoBlock(video)}`;
        console.log(`🎥 Відео додано: ${video.title.slice(0, 50)}`);
      }
    }

    // Публікація
    const { uuid: draftUuid, content: finalContent } = await PostService.createDraft(
      token,
      content,
      article.imageUrl || null,
      user.username    || null,
    );

    const postUuid = await PostService.publishPost(token, finalContent, draftUuid);

    console.log(`✅ Опубліковано: ${postUuid}`);
    console.log(`🔗 https://strada.com.ua/?publication=${postUuid}&type=post`);

    // Позначаємо як використану
    article.used        = true;
    article.used_at     = new Date().toISOString();
    article.published_by = user.character_name;
    writeQueue(queue);

    updateState({ last_publish: new Date().toISOString() });

    await DiscordLogger.postPublished(user, article, postUuid);
  } catch (err) {
    console.error(`❌ Помилка (${user.character_name}): ${err.message}`);
    await DiscordLogger.postFailed(user, article, err.message);
  } finally {
    AuthService.clearToken(user.email);
  }
}

// Пряме виконання: node src/jobs/publishPosts.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishPosts().catch(console.error);
}
