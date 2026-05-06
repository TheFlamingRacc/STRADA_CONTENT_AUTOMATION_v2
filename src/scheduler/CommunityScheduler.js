import { SCHEDULE, COMMUNITIES, YOUTUBE_POSTS } from '../config.js';
import { getKyivDate, formatTime } from '../utils/timeUtils.js';

export default class CommunityScheduler {
  #schedule = []; // [{ time: Date, community: object, type: 'rss'|'youtube' }]

  /**
   * Генерує загальний пул слотів для всіх спільнот на сьогодні.
   *
   * Розподіл: total = randomInt(min, max). Кожна спільнота отримує
   * `floor(total / N)` слотів, перші `total % N` (у перемішаному порядку) — +1.
   *
   * Час кожного слоту — рандомний у межах активних годин. Якщо випав час
   * у минулому (наприклад, при перезапуску бота вдень), слот **дропається**
   * (як це робить DailyScheduler для юзер-постів) — щоб ранкові пости не
   * перетягувалися у вечір і не виходило 35-45 постів за пару годин.
   *
   * Кожна спільнота втрачає пропорційну частку слотів від past-time, тому
   * розподіл лишається рівномірним.
   *
   * @param {Array} communities — масив об'єктів спільнот
   * @returns {Array} — масив слотів (для передачі в Discord)
   */
  generate(communities) {
    if (!communities?.length) {
      this.#schedule = [];
      return [];
    }

    const kyivNow = getKyivDate();
    const total   = this.#randomInt(COMMUNITIES.postsPerDayMin, COMMUNITIES.postsPerDayMax);

    // Перемішуємо спільноти, потім розподіляємо: base слотів кожній + 1 для перших `extra`.
    const shuffled = [...communities].sort(() => Math.random() - 0.5);
    const N        = shuffled.length;
    const base     = Math.floor(total / N);
    const extra    = total % N;

    const slots   = [];
    let dropped   = 0;
    shuffled.forEach((community, idx) => {
      const want = base + (idx < extra ? 1 : 0);
      for (let j = 0; j < want; j++) {
        const hour     = this.#randomInt(SCHEDULE.activeHourStart, SCHEDULE.activeHourEnd);
        const minute   = this.#randomInt(0, 59);
        const postTime = getKyivDate();
        postTime.setHours(hour, minute, 0, 0);

        if (postTime > kyivNow) {
          const type = YOUTUBE_POSTS.enabled && Math.random() < YOUTUBE_POSTS.postChance ? 'youtube' : 'rss';
          slots.push({ time: postTime, community, type });
        } else {
          dropped++;
        }
      }
    });

    this.#schedule = slots.sort((a, b) => a.time - b.time);

    // Підрахунок per-community для лога
    const perCommunity = new Map();
    this.#schedule.forEach(s => {
      perCommunity.set(s.community.slug, (perCommunity.get(s.community.slug) ?? 0) + 1);
    });

    let log = `\n🏁 --- СПІЛЬНОТИ РОЗКЛАД (${this.#schedule.length} постів, ${N} спільнот`;
    if (dropped) log += `, ${dropped} past-time дропнуто`;
    log += `) ---\n`;
    this.#schedule.forEach((s, i) => {
      const icon = s.type === 'youtube' ? '📺' : '📰';
      log += `  ${String(i + 1).padStart(2, ' ')}. [${formatTime(s.time)}] ${s.community.name} ${icon}\n`;
    });
    log += `\n📊 Розподіл по спільнотах:\n`;
    shuffled.forEach(c => {
      log += `  • ${c.name}: ${perCommunity.get(c.slug) ?? 0}\n`;
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
