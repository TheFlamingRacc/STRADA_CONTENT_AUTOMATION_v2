import GeminiService from '../services/GeminiService.js';
import { readUserProfiles, writeUserProfiles, readQueue } from '../utils/dataStore.js';

/**
 * Аналізує опубліковані пости кожного юзера і кешує їхні теми інтересів.
 * Використовується для підбору релевантних статей під конкретного юзера.
 */
export default class UserProfiler {
  /**
   * Оновлює профіль одного юзера на основі його опублікованих постів.
   */
  static async updateProfile(user) {
    const queue = readQueue();

    const publishedTitles = queue
      .filter(a => a.used && a.published_by === user.character_name)
      .map(a => a.title);

    if (publishedTitles.length < 3) return; // Замало даних — не аналізуємо

    const interests = await GeminiService.analyzeUserInterests(publishedTitles);
    if (!interests.length) return;

    const profiles = readUserProfiles();
    profiles[user.id] = {
      interests,
      updated_at: new Date().toISOString(),
    };
    writeUserProfiles(profiles);

    console.log(`📊 Профіль ${user.character_name}: [${interests.join(', ')}]`);
  }

  /**
   * Повертає теми інтересів юзера з кешу.
   */
  static getInterests(userId) {
    const profiles = readUserProfiles();
    return profiles[userId]?.interests ?? [];
  }

  /**
   * Знаходить найрелевантнішу статтю для юзера з черги.
   * Якщо профіль не налаштований — повертає null (використається стандартний вибір).
   *
   * @param {object} user
   * @param {Array}  queue — масив статей
   */
  static findRelevantArticle(user, queue) {
    const interests = this.getInterests(user.id);
    if (!interests.length) return null;

    const available = queue.filter(a => !a.used);
    if (!available.length) return null;

    // Рахуємо score — скільки ключових тем збігається з заголовком/summary
    const scored = available.map(article => {
      const text  = `${article.title} ${article.summary}`.toLowerCase();
      const score = interests.filter(interest =>
        text.includes(interest.toLowerCase())
      ).length;
      return { article, score };
    });

    // Сортуємо по score, беремо топ з рандомом
    const top = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!top.length) return null;

    return top[Math.floor(Math.random() * top.length)].article;
  }

  /**
   * Оновлює профілі всіх юзерів. Запускається раз на добу.
   */
  static async updateAll(users) {
    console.log('\n📊 [profiler] Оновлюємо профілі юзерів...');
    for (const user of users) {
      try {
        await UserProfiler.updateProfile(user);
      } catch (err) {
        console.warn(`⚠️  Профіль ${user.character_name}: ${err.message}`);
      }
    }
    console.log('✅ [profiler] Профілі оновлено');
  }
}
