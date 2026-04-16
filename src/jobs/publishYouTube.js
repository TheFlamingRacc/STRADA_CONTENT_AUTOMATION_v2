import { fileURLToPath } from 'url';
import AuthService from '../services/AuthService.js';
import PostService from '../services/PostService.js';
import GeminiService from '../services/GeminiService.js';
import YouTubeService from '../services/YouTubeService.js';
import { updateState, readPublishedVideoIds, markVideoPublished } from '../utils/dataStore.js';
import { getUsers } from '../config.js';
import DiscordLogger from '../utils/DiscordLogger.js';

/**
 * Публікує один пост на основі YouTube відео.
 * Знаходить відео → отримує транскрипт → генерує текст → публікує.
 *
 * @param {Array}       users    — список всіх юзерів
 * @param {object|null} nextSlot — наступний слот розкладу (для Discord)
 */
export async function publishYouTubePost(users = [], nextSlot = null) {
  if (!YouTubeService.enabled) {
    console.log('ℹ️  YouTube вимкнено (немає YOUTUBE_API_KEY)');
    return null;
  }

  console.log('\n🎬 [youtube] Шукаємо відео...');

  const publishedIds = readPublishedVideoIds();
  const video = await YouTubeService.findRandomAutoVideo(publishedIds);
  if (!video) {
    console.warn('⚠️  Не вдалось знайти відео');
    return null;
  }

  console.log(`🎬 Відео: ${video.title} (${video.channel})`);

  // Транскрипт — якщо є, то набагато краще
  const transcript = await YouTubeService.getTranscript(video.videoId);
  console.log(transcript ? `📄 Транскрипт: ${transcript.length} символів` : '📄 Транскрипт недоступний — використовуємо опис');

  // Рандомний юзер
  const user = users[Math.floor(Math.random() * users.length)];
  if (!user) {
    console.error('❌ Немає юзерів');
    return null;
  }

  console.log(`👤 Автор: ${user.character_name}`);

  try {
    const { token } = await AuthService.login(user.email, user.password);

    const content = await GeminiService.generateYouTubePost(video, transcript, user);

    const { uuid: draftUuid, content: finalContent } = await PostService.createDraft(
      token,
      content,
      [],
      [],
      user.username || null,
    );

    const postUuid = await PostService.publishPost(token, finalContent, draftUuid);

    console.log(`✅ YouTube пост опубліковано: ${postUuid}`);
    console.log(`🔗 https://strada.com.ua/?publication=${postUuid}&type=post`);

    markVideoPublished(video.videoId);
    updateState({ last_publish: new Date().toISOString() });

    await DiscordLogger.youtubePostPublished(user, video, postUuid, nextSlot);

    return { user, video };
  } catch (err) {
    console.error(`❌ YouTube пост помилка: ${err.message}`);
    await DiscordLogger.error('❌ YouTube пост не вдався', err.message);
    return null;
  } finally {
    AuthService.clearToken(user.email);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const users = getUsers();
  publishYouTubePost(users).catch(console.error);
}
