import cron from 'node-cron';
import { SCHEDULE, ENGAGEMENT, STORIES, YOUTUBE_POSTS, getUsers } from './config.js';
import DailyScheduler from './scheduler/DailyScheduler.js';
import { collectArticles } from './jobs/collectArticles.js';
import { publishPosts } from './jobs/publishPosts.js';
import { publishStories } from './jobs/publishStories.js';
import { publishYouTubePost } from './jobs/publishYouTube.js';
import { runEngagement } from './jobs/engagementJob.js';
import UserProfiler from './analytics/UserProfiler.js';
import { hasUnusedArticles } from './utils/dataStore.js';
import { getKyivDate, formatTime } from './utils/timeUtils.js';
import DiscordLogger from './utils/DiscordLogger.js';

// ─── Ініціалізація ─────────────────────────────────────────────────────────────
const scheduler = new DailyScheduler();
let isPublishing = false;

// Рандомні часи engagement на поточний день
let engagementSlots = []; // [{ time: Date }]

function generateEngagementSlots() {
  const kyivNow = getKyivDate();
  const count   = randomInt(ENGAGEMENT.runsPerDayMin, ENGAGEMENT.runsPerDayMax);
  const slots   = [];

  for (let i = 0; i < count; i++) {
    const hour   = randomInt(SCHEDULE.activeHourStart, SCHEDULE.activeHourEnd);
    const minute = randomInt(0, 59);
    const t      = getKyivDate();
    t.setHours(hour, minute, 0, 0);
    if (t > kyivNow) slots.push({ time: t });
  }

  engagementSlots = slots.sort((a, b) => a.time - b.time);
  const times = engagementSlots.map(s => formatTime(s.time)).join(', ');
  console.log(`👍 Engagement розклад (${engagementSlots.length}): ${times || '—'}`);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getActiveUsers() {
  const users = getUsers();
  if (!users.length) {
    console.error('❌ Список юзерів порожній! Перевір USERS_JSON або data/users.json');
  }
  return users;
}

// ─── Основна функція публікації ────────────────────────────────────────────────
const MAX_PUBLISH_ATTEMPTS = 3;

async function runSinglePost(targetUser) {
  if (isPublishing) {
    console.log('⏳ Публікація вже в процесі, пропускаємо слот');
    return;
  }
  isPublishing = true;

  try {
    const users = getActiveUsers();

    // YouTube пост з налаштованим шансом — замість звичайного RSS поста
    if (YOUTUBE_POSTS.enabled && Math.random() < YOUTUBE_POSTS.postChance) {
      for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt++) {
        try {
          const result = await publishYouTubePost(users, scheduler.next);
          if (result) return;
        } catch (err) {
          console.warn(`⚠️ YouTube спроба ${attempt}/${MAX_PUBLISH_ATTEMPTS}: ${err.message}`);
        }
        if (attempt < MAX_PUBLISH_ATTEMPTS) console.log(`🔄 Повторна спроба YouTube (${attempt + 1}/${MAX_PUBLISH_ATTEMPTS})...`);
      }
      // YouTube не вдався — fallback на RSS щоб слот не пропав
      console.log('⚠️ YouTube не вдався — публікуємо RSS пост замість нього');
      await DiscordLogger.warn('⚠️ YouTube не вдався', 'Fallback на RSS пост');
    }

    // Черга порожня — запускаємо позачерговий збір перед публікацією
    if (!hasUnusedArticles()) {
      console.log('⚠️ Черга порожня — позачерговий збір RSS...');
      await DiscordLogger.warn('⚠️ Черга порожня', 'Запускаємо позачерговий збір RSS...');
      try {
        await collectArticles();
      } catch (err) {
        console.error('❌ Позачерговий збір впав:', err.message);
      }
    }

    // RSS публікація з повторними спробами
    for (let attempt = 1; attempt <= MAX_PUBLISH_ATTEMPTS; attempt++) {
      try {
        const result = await publishPosts(targetUser, users, scheduler.next);
        if (result) return;
        // publishPosts повернув null — черга вичерпана або всі статті вже опубліковані
        console.warn(`⚠️ publishPosts повернув null (спроба ${attempt}/${MAX_PUBLISH_ATTEMPTS})`);
        break; // повтор без нових статей безглуздий
      } catch (err) {
        console.warn(`⚠️ Спроба публікації ${attempt}/${MAX_PUBLISH_ATTEMPTS}: ${err.message}`);
      }
      if (attempt < MAX_PUBLISH_ATTEMPTS) console.log(`🔄 Повторна спроба публікації (${attempt + 1}/${MAX_PUBLISH_ATTEMPTS})...`);
    }
    await DiscordLogger.error('❌ Публікація не вдалась після 3 спроб', '');

  } catch (err) {
    console.error('❌ runSinglePost:', err.message);
    await DiscordLogger.error('❌ Критична помилка публікації', err.message);
  } finally {
    isPublishing = false;
  }
}

// ─── Cron: перевірка розкладу кожну хвилину ───────────────────────────────────
cron.schedule('* * * * *', async () => {
  const now = getKyivDate();
  const h   = now.getHours();
  const m   = now.getMinutes();

  // Публікація поста
  const slot = scheduler.checkCurrentMinute();
  if (slot) {
    console.log(`\n🔔 [${now.toLocaleTimeString('uk-UA')}] Час публікації! Автор: ${slot.user.character_name}`);
    await runSinglePost(slot.user);

    if (scheduler.remainingCount > 0) {
      scheduler.logStatus();
    } else {
      console.log('📭 Постів на сьогодні більше немає');
    }
  }

  // Engagement-слот
  const engIdx = engagementSlots.findIndex(
    s => s.time.getHours() === h && s.time.getMinutes() === m,
  );
  if (engIdx !== -1) {
    engagementSlots.splice(engIdx, 1);
    const users        = getActiveUsers();
    const nextEngTime  = engagementSlots[0]?.time ?? null;
    console.log(`\n⏰ [${now.toLocaleTimeString('uk-UA')}] Engagement слот`);
    runEngagement(users, nextEngTime).catch(err => console.error('❌ Engagement:', err.message));
  }

  // Статус-лог кожні 30 хвилин
  if (m % 30 === 0 && now.getSeconds() < 5) {
    scheduler.logStatus();
  }
});

// ─── Cron: оновлення профілів юзерів щодня о 03:00 (Київ) ────────────────────
cron.schedule('0 3 * * *', async () => {
  const users = getActiveUsers();
  await UserProfiler.updateAll(users);
}, { timezone: 'Europe/Kyiv' });

// ─── Cron: оновлення розкладу щоночі о 00:01 (Київ) ──────────────────────────
cron.schedule('1 0 * * *', async () => {
  console.log('\n🌙 Генеруємо новий розклад на завтра...');
  const users = getActiveUsers();
  generateEngagementSlots();
  scheduler.generate(users, engagementSlots.length, engagementSlots[0]?.time ?? null);
}, { timezone: 'Europe/Kyiv' });

// ─── Cron: збір RSS статей щоранку о 05:00 (Київ) ────────────────────────────
cron.schedule('0 5 * * *', async () => {
  console.log('\n🌅 Ранковий збір RSS статей...');
  try {
    await collectArticles();
  } catch (err) {
    console.error('❌ Ранковий збір впав:', err.message);
  }
}, { timezone: 'Europe/Kyiv' });

// ─── Cron: stories — раз на день о 12:00 (Київ) ───────────────────────────────
if (STORIES.enabled) {
  cron.schedule('0 12 * * *', async () => {
    const users = getActiveUsers();
    await publishStories(users);
  }, { timezone: 'Europe/Kyiv' });
}

// ─── Старт ────────────────────────────────────────────────────────────────────
async function start() {
  console.log('🚀 Strada Content Bot запущено');
  console.log(`📋 Режим: ${SCHEDULE.postsPerDayMin}-${SCHEDULE.postsPerDayMax} постів на добу`);
  console.log(`🕐 Активні години: ${SCHEDULE.activeHourStart}:00 — ${SCHEDULE.activeHourEnd}:00 (Київ)`);

  const users = getActiveUsers();
  console.log(`👥 Юзерів: ${users.length}`);

  generateEngagementSlots();
  scheduler.generate(users, engagementSlots.length, engagementSlots[0]?.time ?? null);
  await DiscordLogger.botStarted();
}

start().catch(err => {
  console.error('💥 Помилка старту:', err);
  process.exit(1);
});
