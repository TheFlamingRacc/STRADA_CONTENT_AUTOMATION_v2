import { GoogleGenerativeAI } from "@google/generative-ai";
import GeminiKeyManager from "../utils/GeminiKeyManager.js";
import { randomLinkBlock } from "../utils/linkTemplates.js";
import { CONTENT } from "../config.js";
import { sleep } from "../utils/timeUtils.js";

const MAX_RETRIES = 25;
const RETRY_DELAY_MS = 3000;

export default class GeminiService {
  // ─── Внутрішні утиліти ───────────────────────────────────────────────────────
  static #getModel() {
    const apiKey = GeminiKeyManager.getNextKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    return {
      model: genAI.getGenerativeModel({ model: "gemini-2.5-flash" }),
      apiKey,
    };
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
          err.message.includes("503") ||
          err.message.includes("429") ||
          err.message.includes("high demand") ||
          err.message.includes("fetch failed") ||
          err.message.includes("socket hang up");

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
Analyze if the following news item is directly about cars, trucks, motorcycles, EVs, automotive industry news, car reviews, road safety, or vehicle technology.

Answer YES only if the article is primarily about: a specific vehicle model, car manufacturer news, driving/road topics, automotive technology, fuel/charging, car market, motorsport.

Answer NO if the article is about: tool deals or discounts, garage equipment sales, general power tools, non-vehicle products, lifestyle deals that merely appear on an auto website.

Return ONLY "YES" or "NO". No other text.

Title: ${title}
Summary: ${summary}

Result:`.trim();

    try {
      const text = await this.#generate(prompt);
      return text.toUpperCase().includes("YES");
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
    if (!jsonMatch) throw new Error("Не вдалося розпарсити JSON перекладу");
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Генерує пост від імені персонажа на основі статті.
   */
  static #MOODS = [
    'захоплений — ця тема реально вражає або радує тебе',
    'захоплений — ділишся як фанат, якому є що сказати',
    'нейтральний і аналітичний — розбираєш плюси і мінуси без емоцій',
    'нейтральний — просто ділишся інформацією зі своєї точки зору',
    'скептичний, але конструктивний — є сумніви, але без агресії і з аргументами',
    'здивований — це несподівано або суперечить тому що ти думав раніше',
    'ностальгічний — тема нагадує особистий досвід або старі часи',
    'з гумором і самоіронією — бачиш смішну або абсурдну сторону ситуації',
    'практичний — даєш конкретну пораду або застереження з досвіду',
    'захоплено-критичний — подобається загалом, але є одна суттєва претензія',
  ];

  static #randomMood() {
    return this.#MOODS[Math.floor(Math.random() * this.#MOODS.length)];
  }

  // Визначає мову тексту за унікальними буквами.
  // ы, э, ъ — є тільки в російській; і, ї, є — тільки в українській.
  static #detectLang(text) {
    const ruCount = (text.match(/[ыэъ]/gi) || []).length;
    const ukCount = (text.match(/[іїє]/gi) || []).length;
    return ruCount > ukCount ? 'ru' : 'uk';
  }

  static async generatePost(article, user = null) {
    const isInvented = article.source === "invented";
    const usePersona = !!(user?.persona && user?.prompt);

    const newsBlock = isInvented
      ? (usePersona
          ? `Тема для твоїх думок: "${article.title}". Напиши це як свій досвід, а не новину.`
          : `Тема: "${article.title}"`)
      : `Заголовок: ${article.title}\n${article.summary ? `Деталі: ${article.summary}` : ''}`;

    let prompt;

    if (usePersona) {
      // ── Режим персонажа ──────────────────────────────────────────────────────
      const mood = this.#randomMood();

      const roll = Math.random();
      let lengthInstruction;
      if (roll < CONTENT.shortPostChance) {
        lengthInstruction = "ДОВЖИНА — КОРОТКО: рівно 1 абзац, максимум 3-4 речення. Більше — заборонено.";
      } else if (roll < CONTENT.shortPostChance + CONTENT.mediumPostChance) {
        lengthInstruction = "ДОВЖИНА — СЕРЕДНЬО: 2 абзаци. Не більше.";
      } else {
        lengthInstruction = "ДОВЖИНА — ДЕТАЛЬНО: 3 абзаци. Не більше.";
      }

      prompt = `${user.prompt}

ПРАВИЛА ПОВЕДІНКИ:
- ТИ НЕ АСИСТЕНТ. Ти — реальний користувач форуму.
- НІЯКОЇ ВВІЧЛИВОСТІ: Не дякуй, не вітайся, не пропонуй допомогу.
- СТИЛЬ: Якщо в промпті вказано суржик — пиши ТІЛЬКИ суржиком.
- ЕМОЦІЇ: Будь щирим — твій персонаж не завжди невдоволений. Люди в соцмережах діляться і радістю, і захватом, і жартами — не тільки критикою.
- ОДНОРАЗОВІСТЬ: Не повторюй одну й ту саму думку двічі.

ФОКУС НА ТЕМІ:
- Основа поста — конкретна інформація з інфоприводу: факти, цифри, деталі моделі, події.
- Власна думка або коментар — не більше 30% тексту, як доповнення до теми, а не замість неї.
- Не відходь від теми на загальні роздуми про авто, ринок чи життя якщо вони не пов'язані з інфоприводом.

НАСТРІЙ ЦЬОГО ПОСТА: ${mood}
Підстроюй тон під цей настрій, але залишайся в характері свого персонажа.

ПРАВИЛА ЖИВОЇ МОВИ:
- У 80% випадків починай ОДРАЗУ з теми або емоції.
- Рідко використовуй вступи "Побачив...", "Читаю...", "Натрапив...".
- Не роби висновків "Побачимо, як воно буде".
- Не треба ідеальної граматики і пунктуації — пропущена кома або крапка це норма для живого тексту в соцмережах.

ФОРМАТ:
- Тільки HTML теги <p>...</p>
- Жодних коментарів від нейронки, жодних лапок навколо тексту.
- Жодних префіксів типу "Ось ваш пост:"

${newsBlock}

${lengthInstruction}`;
    } else {
      // ── Режим саммарі (за замовчуванням) ────────────────────────────────────
      const summaryRoll = Math.random();
      const summaryLength = summaryRoll < 0.15
        ? '2 абзаци по 4-5 речень кожен.'
        : summaryRoll < 0.60
          ? '3 абзаци по 4-5 речень кожен.'
          : '4 абзаци по 3-4 речення кожен.';

      prompt = `Ти редактор автомобільного медіа. Напиши інформаційний пост для соціальної мережі на основі наведеної новини.

ПРАВИЛА:
- Мова: українська.
- Стиль: нейтральний, інформаційний. Тільки факти з новини — без особистих думок і оцінок.
- Не вигадуй деталей яких немає в новині.
- Не використовуй кліше: "цікаво", "варто зазначити", "не можна не відмітити".
- Починай одразу з теми — без вступних слів.

ФОРМАТ:
- Тільки HTML теги <p>...</p>. Без markdown, без лапок, без коментарів.
- ${summaryLength}

${newsBlock}`;
    }

    let content = await this.#generate(prompt);

    // Посилання на джерело додаємо програмно — не через Gemini,
    // щоб гарантувати його наявність і точне місце (завжди в кінці).
    // Мова блоку визначається за текстом поста: ы/э/ъ → російська, і/ї/є → українська.
    if (article.source !== "invented") {
      const lang = this.#detectLang(content);
      content = content.trimEnd() + "\n" + randomLinkBlock(article.url, lang);
    }

    return content;
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
   * Перевіряє чи зображення відповідає темі статті.
   * Використовує Gemini Vision (multimodal). При помилці повертає true (не відкидаємо).
   *
   * @param {Buffer} imageBuffer — завантажений буфер зображення
   * @param {string} mimeType    — MIME тип (image/jpeg, image/png...)
   * @param {string} articleTitle — заголовок статті для порівняння
   */
  /**
   * Перевіряє чи зображення підходить для авто-посту.
   * М'яка перевірка: "чи є тут авто або щось пов'язане?" — без прив'язки до конкретної теми.
   * Використовується на етапі збору статей (один раз), а не при публікації.
   */
  static async isImageRelevant(imageBuffer, mimeType) {
    try {
      const base64    = imageBuffer.toString('base64');
      const cleanType = (mimeType || 'image/jpeg').split(';')[0].trim();

      const text = await this.#generate([
        { inlineData: { mimeType: cleanType, data: base64 } },
        `Is this image suitable for an automotive social media post?

Answer YES if the image shows any of: a car, truck, van, SUV, motorcycle, vehicle interior, wheels, engine, exhaust, race track, garage, car dealership, or any road vehicle.

Answer NO only if the image has zero connection to vehicles (e.g. food, portrait of a person with no vehicle, nature with no vehicle, abstract art, text-only banner, or a company logo).

Answer ONLY "YES" or "NO". No other text.`,
      ]);

      return text.toUpperCase().includes('YES');
    } catch {
      return true; // При помилці — не відкидаємо
    }
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
${publishedTitles.slice(0, 20).join("\n")}`;

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
