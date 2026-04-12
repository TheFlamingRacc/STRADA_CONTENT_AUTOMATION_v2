import { SCHEDULE } from '../config.js';
import { getKyivDate, formatTime, getTimeUntil } from '../utils/timeUtils.js';
import DiscordLogger from '../utils/DiscordLogger.js';

export default class DailyScheduler {
  #schedule = []; // [{ time: Date, user: object }]

  /**
   * Генерує розклад постів на сьогодні.
   * Виклик: при старті і щоночі о 00:01.
   */
  generate(users, engagementCount = 0) {
    const kyivNow  = getKyivDate();
    const count    = this.#randomInt(SCHEDULE.postsPerDayMin, SCHEDULE.postsPerDayMax);
    const shuffled = [...users].sort(() => 0.5 - Math.random());
    const slots    = [];

    for (let i = 0; i < count; i++) {
      const hour   = this.#randomInt(SCHEDULE.activeHourStart, SCHEDULE.activeHourEnd);
      const minute = this.#randomInt(0, 59);

      const postTime = getKyivDate();
      postTime.setHours(hour, minute, 0, 0);

      if (postTime > kyivNow) {
        slots.push({
          time: postTime,
          user: shuffled[i % shuffled.length],
        });
      }
    }

    this.#schedule = slots.sort((a, b) => a.time - b.time);

    // Лог розкладу
    let log = `\n📅 --- РОЗКЛАД (${this.#schedule.length} постів) ---\n`;
    this.#schedule.forEach((p, i) => {
      log += `  ${i + 1}. [${formatTime(p.time)}] ${p.user.character_name}\n`;
    });
    console.log(log);

    DiscordLogger.scheduleGenerated(this.#schedule, engagementCount);

    return this.#schedule.length;
  }

  /**
   * Перевіряє чи настав час чергового поста.
   * Повертає { user } або null.
   */
  checkCurrentMinute() {
    const now = getKyivDate();
    const h   = now.getHours();
    const m   = now.getMinutes();

    const idx = this.#schedule.findIndex(
      p => p.time.getHours() === h && p.time.getMinutes() === m
    );

    if (idx === -1) return null;

    const [slot] = this.#schedule.splice(idx, 1); // видаляємо щоб не спрацювало двічі
    return slot;
  }

  /**
   * Повертає інфо про наступний запланований пост.
   */
  get next() {
    return this.#schedule[0] ?? null;
  }

  get remainingCount() {
    return this.#schedule.length;
  }

  logStatus() {
    const next = this.next;
    if (next) {
      console.log(`☕ Бот працює. Наступний пост від ${next.user.character_name} через ${getTimeUntil(next.time)}`);
    }
  }

  #randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
