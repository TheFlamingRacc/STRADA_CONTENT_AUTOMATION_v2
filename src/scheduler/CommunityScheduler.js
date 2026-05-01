import { SCHEDULE, COMMUNITIES, YOUTUBE_POSTS } from '../config.js';
import { getKyivDate, formatTime } from '../utils/timeUtils.js';

export default class CommunityScheduler {
  #schedule = []; // [{ time: Date, community: object, type: 'rss'|'youtube' }]

  /**
   * Генерує загальний пул слотів для всіх спільнот на сьогодні.
   * Загальна кількість: randomInt(min, max) з COMMUNITIES.postsPerDayMin/Max.
   * Спільноти розподіляються round-robin по перемішаному списку.
   * Кожен слот отримує тип 'youtube' або 'rss' з тим самим шансом що й звичайні пости.
   *
   * @param {Array} communities — масив об'єктів спільнот
   * @returns {Array} — масив слотів (для передачі в Discord)
   */
  generate(communities) {
    if (!communities?.length) {
      this.#schedule = [];
      return [];
    }

    const kyivNow  = getKyivDate();
    const count    = this.#randomInt(COMMUNITIES.postsPerDayMin, COMMUNITIES.postsPerDayMax);
    const shuffled = [...communities].sort(() => Math.random() - 0.5);
    const slots    = [];

    for (let i = 0; i < count; i++) {
      const hour     = this.#randomInt(SCHEDULE.activeHourStart, SCHEDULE.activeHourEnd);
      const minute   = this.#randomInt(0, 59);
      const postTime = getKyivDate();
      postTime.setHours(hour, minute, 0, 0);

      if (postTime > kyivNow) {
        const community = shuffled[i % shuffled.length];
        const type      = YOUTUBE_POSTS.enabled && Math.random() < YOUTUBE_POSTS.postChance
          ? 'youtube'
          : 'rss';
        slots.push({ time: postTime, community, type });
      }
    }

    this.#schedule = slots.sort((a, b) => a.time - b.time);

    let log = `\n🏁 --- СПІЛЬНОТИ РОЗКЛАД (${this.#schedule.length} постів) ---\n`;
    this.#schedule.forEach((s, i) => {
      const icon = s.type === 'youtube' ? '📺' : '📰';
      log += `  ${String(i + 1).padStart(2, ' ')}. [${formatTime(s.time)}] ${s.community.name} ${icon}\n`;
    });
    console.log(log);

    return this.#schedule;
  }

  /**
   * Перевіряє чи настав час чергового слоту спільноти.
   * Повертає { community, type } або null.
   */
  checkCurrentMinute() {
    const now = getKyivDate();
    const h   = now.getHours();
    const m   = now.getMinutes();

    const match = s => s.time.getHours() === h && s.time.getMinutes() === m;
    const first = this.#schedule.find(match);
    if (!first) return null;

    const dupes = this.#schedule.filter(match).length;
    if (dupes > 1) {
      console.warn(`⚠️  Колізія community розкладу: ${dupes} слоти на ${h}:${String(m).padStart(2, '0')}, зберігаємо перший`);
    }
    this.#schedule = this.#schedule.filter(s => !match(s));
    return first;
  }

  get next()           { return this.#schedule[0] ?? null; }
  get remainingCount() { return this.#schedule.length; }
  get schedule()       { return this.#schedule; }

  #randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
