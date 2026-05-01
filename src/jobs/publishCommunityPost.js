import { fileURLToPath } from 'url';
import AuthService from '../services/AuthService.js';
import PostService from '../services/PostService.js';
import GeminiService from '../services/GeminiService.js';
import YouTubeService from '../services/YouTubeService.js';
import {
  readCommunityQueue,
  writeCommunityQueue,
  readCommunityPublishedVideoIds,
  markCommunityVideoPublished,
  markCommunityArticlePublished,
} from '../utils/dataStore.js';
import { collectCommunityArticles } from './collectCommunityArticles.js';
import DiscordLogger from '../utils/DiscordLogger.js';

// Захист від повторної публікації однієї статті в межах поточного процесу (per-slug).
const publishedInSession = new Map(); // slug → Set<articleId>

function getSessionSet(slug) {
  if (!publishedInSession.has(slug)) publishedInSession.set(slug, new Set());
  return publishedInSession.get(slug);
}

function imgCount(article) {
  return article.imageUrls?.length || (article.imageUrl ? 1 : 0);
}

function weightedPick(articles) {
  const weights = articles.map(a => imgCount(a) + 1);
  const total   = weights.reduce((s, w) => s + w, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < articles.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return articles[i];
  }
  return articles[articles.length - 1];
}

function findNextArticle(queue) {
  const available = queue.filter(a => !a.used);
  if (!available.length) return null;

  const withImages    = available.filter(a => imgCount(a) > 0);
  const withoutImages = available.filter(a => imgCount(a) === 0);

  if (withImages.length && (withoutImages.length === 0 || Math.random() > 0.15)) {
    return weightedPick(withImages);
  }
  if (withoutImages.length) {
    return withoutImages[Math.floor(Math.random() * withoutImages.length)];
  }
  return weightedPick(withImages);
}

// ─── YouTube пост від спільноти ───────────────────────────────────────────────

async function publishCommunityYouTube(community, nextSlot) {
  const { slug, name } = community;

  if (!YouTubeService.enabled) {
    console.log(`ℹ️  [${slug}] YouTube вимкнено — fallback на RSS`);
    return null;
  }

  const excludeIds = readCommunityPublishedVideoIds(slug);
  const channels   = community.youtube_channels ?? [];

  const video = channels.length
    ? await YouTubeService.findVideoFromChannelList(channels, excludeIds)
    : null;

  if (!video) {
    console.warn(`⚠️  [${slug}] YouTube: відео не знайдено — fallback на RSS`);
    return null;
  }

  console.log(`🎬 [${slug}] Відео: ${video.title}`);

  const transcript = await YouTubeService.getTranscript(video.videoId);
  console.log(transcript ? `📄 Транскрипт: ${transcript.length} символів` : '📄 Транскрипт недоступний — використовуємо опис');

  const { token } = await AuthService.login(community.email, community.password);

  // Передаємо community як "user" — generateYouTubePost підтримує persona: true + prompt
  const content = await GeminiService.generateYouTubePost(
    video,
    transcript,
    { persona: true, prompt: community.prompt, character_name: name },
  );

  const { uuid: postUuid } = await PostService.publishGroupPost(
    token,
    content,
    [],
    [],
    community.username ?? community.email.split('@')[0],
    slug,
  );

  console.log(`✅ [${slug}] YouTube пост опубліковано: ${postUuid}`);

  markCommunityVideoPublished(slug, video.videoId);
  AuthService.clearToken(community.email);

  await DiscordLogger.communityYouTubePostPublished(community, video, postUuid, nextSlot);
  await DiscordLogger.communityInteraction(community, 'youtube', postUuid, nextSlot?.time ?? null);

  return { community, video };
}

// ─── RSS пост від спільноти ───────────────────────────────────────────────────

async function publishCommunityRss(community, nextSlot) {
  const { slug, name } = community;

  let queue = readCommunityQueue(slug);

  // Якщо черга порожня — позачерговий збір
  if (!queue.some(a => !a.used)) {
    console.log(`⚠️  [${slug}] Черга порожня — позачерговий збір...`);
    try {
      await collectCommunityArticles(community);
      queue = readCommunityQueue(slug);
    } catch (err) {
      console.error(`❌ [${slug}] Позачерговий збір впав: ${err.message}`);
    }
  }

  const sessionSet = getSessionSet(slug);
  const safeQueue  = queue.filter(a => !a.used && !sessionSet.has(a.id));
  const article    = findNextArticle(safeQueue);

  if (!article) {
    console.warn(`⚠️  [${slug}] Черга вичерпана!`);
    await DiscordLogger.warn(`⚠️ Черга [${name}]`, 'Немає статей для публікації');
    return null;
  }

  console.log(`\n✍️  [${name}] ${article.title}`);

  const { token } = await AuthService.login(community.email, community.password);

  const content = await GeminiService.generateCommunityPost(article, community);

  const imageUrls  = article.imageUrls?.length ? article.imageUrls : (article.imageUrl ? [article.imageUrl] : []);
  const imagePaths = article.imagePaths || [];

  const { uuid: postUuid, content: finalContent, imageCount } = await PostService.publishGroupPost(
    token,
    content,
    imageUrls,
    imagePaths,
    community.username ?? community.email.split('@')[0],
    slug,
  );

  console.log(`✅ [${slug}] Опубліковано: ${postUuid}`);

  markCommunityArticlePublished(slug, article.url);
  sessionSet.add(article.id);
  article.used    = true;
  article.used_at = new Date().toISOString();
  writeCommunityQueue(slug, queue);
  AuthService.clearToken(community.email);

  await DiscordLogger.communityPostPublished(community, article, postUuid, nextSlot, imageCount);
  await DiscordLogger.communityInteraction(community, 'rss', postUuid, nextSlot?.time ?? null);

  return { community, article };
}

// ─── Точка входу ─────────────────────────────────────────────────────────────

/**
 * Публікує один пост від імені спільноти.
 *
 * @param {object}      community — об'єкт спільноти
 * @param {string}      type      — 'youtube' | 'rss'
 * @param {object|null} nextSlot  — наступний слот (для Discord)
 */
export async function publishCommunityPost(community, type = 'rss', nextSlot = null) {
  const { slug, name } = community;
  console.log(`\n🚀 [community:${slug}] Публікація "${name}" (${type})...`);

  try {
    if (type === 'youtube') {
      const result = await publishCommunityYouTube(community, nextSlot);
      // Fallback на RSS якщо YouTube не дав результату
      if (!result) {
        console.log(`🔄 [${slug}] YouTube fallback → RSS`);
        return await publishCommunityRss(community, nextSlot);
      }
      return result;
    }

    return await publishCommunityRss(community, nextSlot);

  } catch (err) {
    console.error(`❌ [${slug}] Помилка: ${err.message}`);
    await DiscordLogger.communityPostFailed(community, err.message);
    AuthService.clearToken(community.email);
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { getCommunities } = await import('../config.js');
  const communities = getCommunities();
  if (!communities.length) {
    console.error('❌ Немає спільнот у communities.json / COMMUNITIES_JSON');
    process.exit(1);
  }
  publishCommunityPost(communities[0], 'rss').catch(console.error);
}
