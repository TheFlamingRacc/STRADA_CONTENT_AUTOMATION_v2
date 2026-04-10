import cron from 'node-cron';
import { SCHEDULE, ENGAGEMENT, STORIES, getUsers } from './config.js';
import DailyScheduler from './scheduler/DailyScheduler.js';
import { collectArticles } from './jobs/collectArticles.js';
import { publishPosts } from './jobs/publishPosts.js';
import { publishStories } from './jobs/publishStories.js';
import { runEngagement } from './jobs/engagementJob.js';
import UserProfiler from './analytics/UserProfiler.js';
import { hasUnusedArticles } from './utils/dataStore.js';
import { getKyivDate } from './utils/timeUtils.js';
import DiscordLogger from './utils/DiscordLogger.js';

// ─── Ініціалізація ─────────────────────────────────────────────────────────────
const scheduler = new DailyScheduler();
let isPublishing = false;

function getActiveUsers() {
  const users = getUsers();
  if (!users.length) {
    console.error('❌ Список юзерів порожній! Перевір USERS_JSON або data/users.json');
  }
  return users;
}

// ─── Основна функція публікації ────────────────────────────────────────────────
async function runSinglePost(targetUser) {
  if (isPublishing) {
    console.log('⏳ Публікація вже в процесі, пропускаємо слот');
    return;
  }
  isPublishing = true;

  try {
    if (!hasUnusedArticles()) {
      console.log('🔄 Черга порожня — збираємо нові статті...');
      await collectArticles();
    } else {
      console.log('📦 У черзі є статті, використовуємо їх');
    }

    const users = await getActiveUsers();
    await publishPosts(1, targetUser, users);
  } catch (err) {
    console.error('❌ runSinglePost:', err.message);
    await DiscordLogger.error('❌ Критична помилка публікації', err.message);
  } finally {
    isPublishing = false;
  }
}

// ─── Cron: перевірка розкладу кожну хвилину ───────────────────────────────────
cron.schedule('* * * * *', async () => {
  const slot = scheduler.checkCurrentMinute();

  if (slot) {
    const now = getKyivDate();
    console.log(`\n🔔 [${now.toLocaleTimeString('uk-UA')}] Час публікації! Автор: ${slot.user.character_name}`);
    await runSinglePost(slot.user);

    if (scheduler.remainingCount > 0) {
      console.log(`⏭️  Наступний пост через: ${scheduler.next ? getKyivDate() : '—'}`);
      scheduler.logStatus();
    } else {
      console.log('📭 Постів на сьогодні більше немає');
    }
  }

  // Статус-лог кожні 30 хвилин
  const now = getKyivDate();
  if (now.getMinutes() % 30 === 0 && now.getSeconds() < 5) {
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
  const users = await getActiveUsers();
  scheduler.generate(users);
}, { timezone: 'Europe/Kyiv' });

// ─── Cron: engagement ─────────────────────────────────────────────────────────
cron.schedule(ENGAGEMENT.cronSchedule, async () => {
  const users = await getActiveUsers();
  await runEngagement(users);
}, { timezone: 'Europe/Kyiv' });

// ─── Cron: stories — раз на день о 12:00 (Київ) ───────────────────────────────
if (STORIES.enabled) {
  cron.schedule('0 12 * * *', async () => {
    const users = await getActiveUsers();
    await publishStories(users);
  }, { timezone: 'Europe/Kyiv' });
}

// ─── Старт ────────────────────────────────────────────────────────────────────
async function start() {
  console.log('🚀 Strada Content Bot запущено');
  console.log(`📋 Режим: ${SCHEDULE.postsPerDayMin}-${SCHEDULE.postsPerDayMax} постів на добу`);
  console.log(`🕐 Активні години: ${SCHEDULE.activeHourStart}:00 — ${SCHEDULE.activeHourEnd}:00 (Київ)`);

  const users = await getActiveUsers();
  console.log(`👥 Юзерів: ${users.length}`);

  scheduler.generate(users);
  await DiscordLogger.botStarted();
}

start().catch(err => {
  console.error('💥 Помилка старту:', err);
  process.exit(1);
});
