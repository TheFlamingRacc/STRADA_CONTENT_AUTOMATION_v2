import { GoogleGenerativeAI } from '@google/generative-ai';
import GeminiKeyManager from '../utils/GeminiKeyManager.js';
import { randomLinkBlock } from '../utils/linkTemplates.js';
import { CONTENT } from '../config.js';
import { sleep } from '../utils/timeUtils.js';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

export default class GeminiService {
  // ─── Внутрішні утиліти ───────────────────────────────────────────────────────
  static #getModel() {
    const apiKey = GeminiKeyManager.getNextKey();
    const genAI  = new GoogleGenerativeAI(apiKey);
    return { model: genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }), apiKey };
  }

  static async #generate(prompt) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const { model, apiKey } = this.#getModel();
      try {
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
      } catch (err) {
        lastError = err;
        const isRetryable =
          err.message.includes('503') ||
          err.message.includes('429') ||
          err.message.includes('high demand') ||
          err.message.includes('fetch failed') ||
          err.message.includes('socket hang up');

        if (isRetryable) {
          GeminiKeyManager.markFailed(apiKey);
          await sleep(RETRY_DELAY_MS * attempt);
        } else {
          throw err; // Не мережева помилка — одразу кидаємо
        }
      }
    }

    throw lastError;
  }

  // ─── Публічні методи ─────────────────────────────────────────────────────────

  /**
   * Перевіряє чи стаття стосується автомобільної теми.
   */
  static async isAutoRelated(title, summary) {
    const prompt = `
Analyze if the following news item is related to the automotive industry,
car culture, road safety, or vehicle technology.
Return ONLY "YES" or "NO". No other text.

Title: ${title}
Summary: ${summary}

Result:`.trim();

    try {
      const text = await this.#generate(prompt);
      return text.toUpperCase().includes('YES');
    } catch {
      return true; // При помилці — не відкидаємо статтю
    }
  }

  /**
   * Перекладає заголовок і summary на українську.
   */
  static async translateArticle(title, summary) {
    const prompt = `Переклади на українську мову. Відповідай ТІЛЬКИ валідним JSON без жодного додаткового тексту і без markdown.
{"title": "...", "summary": "..."}

Title: ${title}
Summary: ${summary}`;

    const text = await this.#generate(prompt);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Не вдалося розпарсити JSON перекладу');
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Генерує пост від імені персонажа на основі статті.
   */
  static async generatePost(article, user) {
    if (!user?.prompt) {
      throw new Error(`Немає промпту для юзера id=${user?.id}`);
    }

    // Рандомна довжина
    const roll = Math.random();
    let lengthInstruction;
    if (roll < CONTENT.shortPostChance) {
      lengthInstruction = 'ДОВЖИНА: Короткий коментар. 1-2 абзаци.';
    } else if (roll < CONTENT.shortPostChance + CONTENT.mediumPostChance) {
      lengthInstruction = 'ДОВЖИНА: Середній пост. 2-3 абзаци.';
    } else {
      lengthInstruction = 'ДОВЖИНА: Детальний пост. 3-4 абзаци.';
    }

    let newsBlock;
    let sourceBlock = '';

    if (article.source === 'invented') {
      newsBlock = `Тема для твоїх думок: "${article.title}". Напиши це як свій досвід, а не новину.`;
    } else {
      const linkBlock = randomLinkBlock(article.url);
      sourceBlock     = `\n- В самому кінці додай цей HTML блок: ${linkBlock}`;
      newsBlock       = `Інфопривід: ${article.title}\nКонтекст: ${article.summary}`;
    }

    const prompt = `${user.prompt}

ПРАВИЛА ПОВЕДІНКИ:
- ТИ НЕ АСИСТЕНТ. Ти — реальний користувач форуму.
- НІЯКОЇ ВВІЧЛИВОСТІ: Не дякуй, не вітайся, не пропонуй допомогу.
- СТИЛЬ: Якщо в промпті вказано суржик — пиши ТІЛЬКИ суржиком.
- ГРУБІСТЬ: Можеш бути різким, скептичним або незадоволеним.
- ОДНОРАЗОВІСТЬ: Не повторюй одну й ту саму думку двічі.

ПРАВИЛА ЖИВОЇ МОВИ:
- У 80% випадків починай ОДРАЗУ з теми або емоції.
- Рідко використовуй вступи "Побачив...", "Читаю...", "Натрапив...".
- Не роби висновків "Побачимо, як воно буде".

${lengthInstruction}

ФОРМАТ:
- Тільки HTML теги <p>...</p>
- Жодних коментарів від нейронки, жодних лапок навколо тексту.
- Жодних префіксів типу "Ось ваш пост:"${sourceBlock}

${newsBlock}`;

    return this.#generate(prompt);
  }

  /**
   * Генерує короткий текст для story.
   */
  static async generateStory(user, topic) {
    if (!user?.prompt) {
      throw new Error(`Немає промпту для юзера id=${user?.id}`);
    }

    const prompt = `${user.prompt}

Напиши дуже короткий story (1-2 речення максимум) на тему: "${topic}".
Це story в соцмережі — ніяких довгих текстів.
Формат: тільки текст, без HTML тегів, без лапок навколо.`;

    return this.#generate(prompt);
  }

  /**
   * Аналізує інтереси юзера по опублікованим постам.
   * Повертає масив ключових тем.
   */
  static async analyzeUserInterests(publishedTitles) {
    if (!publishedTitles?.length) return [];

    const prompt = `На основі цих заголовків автомобільних постів визнач 5-7 ключових тем інтересів автора.
Відповідай ТІЛЬКИ JSON масивом рядків без markdown.
Приклад: ["електромобілі", "JDM", "тюнінг", "Формула 1"]

Заголовки:
${publishedTitles.slice(0, 20).join('\n')}`;

    try {
      const text = await this.#generate(prompt);
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) return [];
      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
}
