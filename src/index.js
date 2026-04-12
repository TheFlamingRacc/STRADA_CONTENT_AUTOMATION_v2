import cron from 'node-cron';
import { SCHEDULE, ENGAGEMENT, STORIES, getUsers } from './config.js';
import DailyScheduler from './scheduler/DailyScheduler.js';
import { collectArticles } from './jobs/collectArticles.js';
import { publishPosts } from './jobs/publishPosts.js';
import { publishStories } from './jobs/publishStories.js';
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

    const users = getActiveUsers();
    await publishPosts(targetUser, users, scheduler.next);
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
    const users = getActiveUsers();
    console.log(`\n⏰ [${now.toLocaleTimeString('uk-UA')}] Engagement слот`);
    runEngagement(users).catch(err => console.error('❌ Engagement:', err.message));
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
  scheduler.generate(users, engagementSlots.length);
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
  scheduler.generate(users, engagementSlots.length);
  await DiscordLogger.botStarted();
}

start().catch(err => {
  console.error('💥 Помилка старту:', err);
  process.exit(1);
});
