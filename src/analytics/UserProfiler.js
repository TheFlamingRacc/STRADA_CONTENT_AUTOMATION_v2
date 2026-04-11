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
   * Знаходить найрелевантнішу статтю для юзера з черги на основі збережених інтересів.
   * Якщо профіль не налаштований — повертає null.
   *
   * @param {object} user
   * @param {Array}  queue — масив статей
   */
  static findRelevantArticle(user, queue) {
    const interests = this.getInterests(user.id);
    if (!interests.length) return null;

    const available = queue.filter(a => !a.used);
    if (!available.length) return null;

    const scored = available.map(article => {
      const text       = `${article.title} ${article.summary}`.toLowerCase();
      const topicScore = interests.filter(interest => text.includes(interest.toLowerCase())).length;
      const imgBonus   = Math.min(article.imageUrls?.length || (article.imageUrl ? 1 : 0), 3) * 0.3;
      return { article, score: topicScore + imgBonus };
    });

    const top = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!top.length) return null;

    return top[Math.floor(Math.random() * top.length)].article;
  }

  /**
   * Підбирає статтю на основі ключових слів з промпту юзера.
   * Використовується як fallback коли профіль ще не накопичений.
   *
   * @param {object} user
   * @param {Array}  queue — масив статей
   */
  static matchByPrompt(user, queue) {
    if (!user?.prompt) return null;

    const available = queue.filter(a => !a.used);
    if (!available.length) return null;

    const STOPWORDS = new Set([
      'ти', 'це', 'той', 'та', 'але', 'або', 'якщо', 'що', 'як', 'він',
      'вона', 'вони', 'його', 'її', 'їх', 'для', 'від', 'про', 'при',
      'після', 'перед', 'між', 'через', 'над', 'під', 'без', 'зі', 'зо',
      'пишеш', 'пишу', 'пише', 'часто', 'іноді', 'завжди', 'ніколи',
      'дуже', 'трохи', 'добре', 'погано', 'тобі', 'мені', 'собі',
      'своїх', 'своє', 'свого', 'нових', 'нова', 'нове', 'новий',
      'років', 'роки', 'рік', 'місто', 'міста', 'реальний', 'реальна',
      'коли', 'тому', 'тільки', 'навіть', 'також', 'вже', 'ще', 'ось',
      'були', 'буде', 'бути', 'є', 'має', 'можна', 'треба', 'можеш',
    ]);

    const keywords = user.prompt
      .toLowerCase()
      .replace(/[.,!?;:()"'«»\n\r]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w));

    if (!keywords.length) return null;

    const scored = available.map(article => {
      const text       = `${article.title} ${article.summary}`.toLowerCase();
      const topicScore = keywords.filter(kw => text.includes(kw)).length;
      const imgBonus   = Math.min(article.imageUrls?.length || (article.imageUrl ? 1 : 0), 3) * 0.3;
      return { article, score: topicScore + imgBonus };
    });

    const top = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!top.length) return null;

    const match = top[Math.floor(Math.random() * top.length)].article;
    console.log(`🎯 Підібрано за промптом: "${match.title.slice(0, 60)}"`);
    return match;
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
