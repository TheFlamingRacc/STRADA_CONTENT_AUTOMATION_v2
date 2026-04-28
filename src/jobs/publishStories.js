import { fileURLToPath } from 'url';
import { mkdirSync, unlinkSync, existsSync } from 'fs';
import path from 'path';
import AuthService from '../services/AuthService.js';
import StoryService from '../services/StoryService.js';
import GeminiService from '../services/GeminiService.js';
import YouTubeService from '../services/YouTubeService.js';
import { STORIES, DATA_DIR, getUsers } from '../config.js';
import { readPublishedStoryVideoIds, markStoryVideoPublished } from '../utils/dataStore.js';
import { sleepRandom } from '../utils/timeUtils.js';
import DiscordLogger from '../utils/DiscordLogger.js';

const TMP_DIR = path.join(DATA_DIR, 'tmp');

export async function publishStories(users = []) {
  if (!STORIES.enabled) {
    console.log('ℹ️  Stories вимкнено (STORIES_ENABLED=false)');
    return;
  }

  if (!YouTubeService.enabled) {
    console.log('ℹ️  Stories пропущено — YOUTUBE_API_KEY не вказано');
    return;
  }

  const count = Math.floor(Math.random() * (STORIES.perDayMax - STORIES.perDayMin + 1)) + STORIES.perDayMin;
  console.log(`\n📖 [stories] Публікуємо ${count} stories...`);

  mkdirSync(TMP_DIR, { recursive: true });

  const selectedUsers = [...users]
    .sort(() => 0.5 - Math.random())
    .slice(0, count);

  const excludeIds = readPublishedStoryVideoIds();
  let published = 0;

  for (const user of selectedUsers) {
    let videoPath = null;
    try {
      // ── 1. Знаходимо Short ────────────────────────────────────────────────────
      const short = await YouTubeService.findShort(excludeIds);
      if (!short) {
        console.warn(`⚠️  Story (${user.character_name}): не знайдено жодного Short`);
        continue;
      }
      console.log(`  🎬 Short: "${short.title}" [${short.channel}]`);

      // ── 2. Завантажуємо відео ─────────────────────────────────────────────────
      videoPath = path.join(TMP_DIR, `story_${short.videoId}.mp4`);
      await YouTubeService.downloadVideo(short.videoId, videoPath);

      // ── 3. Генеруємо підпис через Gemini ─────────────────────────────────────
      const description = await GeminiService.generateVideoStory(
        user, short.title, short.channel,
      );

      // ── 4. Публікуємо сторіс ─────────────────────────────────────────────────
      const { token } = await AuthService.login(user.email, user.password);
      const uuid      = await StoryService.publishStory(token, description, videoPath);

      // ── 5. Фіксуємо і прибираємо тимчасовий файл ─────────────────────────────
      markStoryVideoPublished(short.videoId);
      excludeIds.push(short.videoId);

      console.log(`  ✓ Story від ${user.character_name}: ${description.slice(0, 60)}...`);
      published++;
      AuthService.clearToken(user.email);
    } catch (err) {
      console.warn(`⚠️  Story (${user.character_name}): ${err.message}`);
    } finally {
      if (videoPath && existsSync(videoPath)) {
        try { unlinkSync(videoPath); } catch {}
      }
    }

    await sleepRandom(5000, 15000);
  }

  console.log(`✅ [stories] Опубліковано: ${published}`);
  if (published > 0) {
    await DiscordLogger.info('📖 Stories опубліковано', `Кількість: ${published}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishStories(getUsers()).catch(console.error);
}
