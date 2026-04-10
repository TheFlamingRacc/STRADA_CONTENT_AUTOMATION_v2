import { fileURLToPath } from 'url';
import AuthService from '../services/AuthService.js';
import PostService from '../services/PostService.js';
import GeminiService from '../services/GeminiService.js';
import YouTubeService from '../services/YouTubeService.js';
import { readQueue, writeQueue, updateState } from '../utils/dataStore.js';
import UserProfiler from '../analytics/UserProfiler.js';
import { CONTENT } from '../config.js';
import DiscordLogger from '../utils/DiscordLogger.js';

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
 * @param {object|null} targetUser — конкретний юзер з розкладу або null (рандом)
 * @param {Array}       users      — список всіх юзерів (для рандому)
 * @param {object|null} nextSlot   — наступний слот розкладу (для Discord повідомлення)
 */
export async function publishPosts(targetUser = null, users = [], nextSlot = null) {
  console.log('\n🚀 [publish] Починаємо публікацію...');

  const queue = readQueue();

  const user = targetUser ?? users[Math.floor(Math.random() * users.length)];
  if (!user) {
    console.error('❌ Немає юзерів для публікації');
    return;
  }

  console.log(`👤 Автор: ${user.character_name} (${user.username})`);

  const article = UserProfiler.findRelevantArticle(user, queue) || findNextArticle(queue);
  if (!article) {
    console.warn('⚠️  Черга порожня!');
    await DiscordLogger.warn('⚠️ Черга порожня', 'Немає статей для публікації');
    return;
  }

  try {
    console.log(`\n✍️  [${user.character_name}] ${article.title}`);

    const { token } = await AuthService.login(user.email, user.password);

    // Генерація контенту (retry всередині GeminiService — тут тихо)
    let content = await GeminiService.generatePost(article, user);

    // YouTube відео з шансом
    if (YouTubeService.enabled && Math.random() < CONTENT.youtubeInPostChance) {
      const video = await YouTubeService.findVideo(article.title);
      if (video) {
        content += `\n${YouTubeService.videoBlock(video)}`;
        console.log(`🎥 Відео: ${video.title.slice(0, 50)}`);
      }
    }

    const { uuid: draftUuid, content: finalContent } = await PostService.createDraft(
      token,
      content,
      article.imageUrl || null,
      user.username    || null,
    );

    const postUuid = await PostService.publishPost(token, finalContent, draftUuid);

    console.log(`✅ Опубліковано: ${postUuid}`);
    console.log(`🔗 https://strada.com.ua/?publication=${postUuid}&type=post`);

    article.used         = true;
    article.used_at      = new Date().toISOString();
    article.published_by = user.character_name;
    writeQueue(queue);
    updateState({ last_publish: new Date().toISOString() });

    await DiscordLogger.postPublished(user, article, postUuid, nextSlot);
  } catch (err) {
    console.error(`❌ Помилка (${user.character_name}): ${err.message}`);
    await DiscordLogger.postFailed(user, article, err.message, nextSlot);
  } finally {
    AuthService.clearToken(user.email);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishPosts().catch(console.error);
}
