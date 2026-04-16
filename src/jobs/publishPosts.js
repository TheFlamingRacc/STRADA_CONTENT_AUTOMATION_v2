import { fileURLToPath } from "url";
import AuthService from "../services/AuthService.js";
import PostService from "../services/PostService.js";
import GeminiService from "../services/GeminiService.js";
import YouTubeService from "../services/YouTubeService.js";
import { readQueue, writeQueue, updateState } from "../utils/dataStore.js";
import UserProfiler from "../analytics/UserProfiler.js";
import { CONTENT } from "../config.js";
import DiscordLogger from "../utils/DiscordLogger.js";

// Захист від повторної публікації однієї статті в межах поточного процесу.
// Доповнює article.used у файлі на випадок race condition або багу у виборці.
const publishedInSession = new Set();

function imgCount(article) {
  return article.imageUrls?.length || (article.imageUrl ? 1 : 0);
}

// Вагова вибірка: стаття з більшою кількістю фото має вищий шанс
function weightedPick(articles) {
  const weights = articles.map((a) => imgCount(a) + 1); // +1 щоб вага ніколи не була 0
  const total = weights.reduce((s, w) => s + w, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < articles.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return articles[i];
  }
  return articles[articles.length - 1];
}

function findNextArticle(queue) {
  const available = queue.filter((a) => !a.used);
  if (!available.length) return null;

  const withImages = available.filter((a) => imgCount(a) > 0);
  const withoutImages = available.filter((a) => imgCount(a) === 0);

  // Статті без фото: 15% шанс потрапити у вибірку якщо є альтернативи
  if (
    withImages.length &&
    (withoutImages.length === 0 || Math.random() > 0.15)
  ) {
    return weightedPick(withImages);
  }

  // Якщо пройшов шанс або немає фото — вибираємо зі статтями без фото
  if (withoutImages.length) {
    return withoutImages[Math.floor(Math.random() * withoutImages.length)];
  }

  return weightedPick(withImages);
}

/**
 * Публікує один пост від обраного юзера.
 *
 * @param {object|null} targetUser — конкретний юзер з розкладу або null (рандом)
 * @param {Array}       users      — список всіх юзерів (для рандому)
 * @param {object|null} nextSlot   — наступний слот розкладу (для Discord повідомлення)
 */
/**
 * Публікує один пост від обраного юзера.
 * Повертає { user, article } для відображення прогресу — або null при помилці.
 *
 * @param {object|null} targetUser — конкретний юзер з розкладу або null (рандом)
 * @param {Array}       users      — список всіх юзерів (для рандому)
 * @param {object|null} nextSlot   — наступний слот розкладу (для Discord повідомлення)
 */
export async function publishPosts(
  targetUser = null,
  users = [],
  nextSlot = null,
) {
  console.log("\n🚀 [publish] Починаємо публікацію...");

  const queue = readQueue();

  const user = targetUser ?? users[Math.floor(Math.random() * users.length)];
  if (!user) {
    console.error("❌ Немає юзерів для публікації");
    return null;
  }

  console.log(`👤 Автор: ${user.character_name} (${user.username})`);

  // Для саммарі вигадані теми не підходять — нема що переказувати
  const eligibleQueue = user.persona
    ? queue
    : queue.filter((a) => a.source !== "invented");

  // Виключаємо вже опубліковані в цій сесії (захист від race condition)
  const safeQueue = eligibleQueue.filter(a => !publishedInSession.has(a.id));

  const article =
    UserProfiler.findRelevantArticle(user, safeQueue) ||
    UserProfiler.matchByPrompt(user, safeQueue) ||
    findNextArticle(safeQueue);
  if (!article) {
    console.warn("⚠️  Черга порожня!");
    await DiscordLogger.warn("⚠️ Черга порожня", "Немає статей для публікації");
    return null;
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

    // Збираємо масив картинок: новий формат (imageUrls) або fallback на imageUrl
    const imageUrls = article.imageUrls?.length
      ? article.imageUrls
      : article.imageUrl
        ? [article.imageUrl]
        : [];
    const imagePaths = article.imagePaths || [];

    const {
      uuid: draftUuid,
      content: finalContent,
      imageCount,
    } = await PostService.createDraft(
      token,
      content,
      imageUrls,
      imagePaths,
      user.username || null,
    );

    const postUuid = await PostService.publishPost(
      token,
      finalContent,
      draftUuid,
    );

    console.log(`✅ Опубліковано: ${postUuid}`);
    console.log(`🔗 https://strada.com.ua/?publication=${postUuid}&type=post`);

    publishedInSession.add(article.id);
    article.used = true;
    article.used_at = new Date().toISOString();
    article.published_by = user.character_name;
    writeQueue(queue);
    updateState({ last_publish: new Date().toISOString() });

    await DiscordLogger.postPublished(
      user,
      article,
      postUuid,
      nextSlot,
      imageCount,
    );
    return { user, article };
  } catch (err) {
    console.error(`❌ Помилка (${user.character_name}): ${err.message}`);
    await DiscordLogger.postFailed(user, article, err.message, nextSlot);
    return null;
  } finally {
    AuthService.clearToken(user.email);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishPosts().catch(console.error);
}
