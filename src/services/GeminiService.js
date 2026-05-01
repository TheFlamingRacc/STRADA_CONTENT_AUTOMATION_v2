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

  // Видаляє однакові послідовні <p> блоки — захист від повторення Gemini.
  static #deduplicateParagraphs(content) {
    const parts = content.split('</p>').filter(p => p.trim());
    const unique = parts.filter((p, i) => i === 0 || p.trim() !== parts[i - 1].trim());
    return unique.join('</p>') + (unique.length ? '</p>' : '');
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

    let content = GeminiService.#deduplicateParagraphs(await this.#generate(prompt));

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
   * Генерує пост на основі YouTube відео і транскрипту.
   * Мета: заінтригувати, не переказати все — заохотити до перегляду.
   *
   * @param {object}      video      — { title, channel, url, description }
   * @param {string|null} transcript — транскрипт відео (або null)
   * @param {object|null} user       — юзер з persona/prompt (або null для саммарі)
   */
  // Рандомна структура YouTube поста: скільки абзаців і де відео.
  // Повертає { paragraphCount, videoPosition }
  // videoPosition: 0 = перед усіма абзацами, N = після N-го абзацу
  static #randomYouTubeLayout() {
    const roll = Math.random();
    if (roll < 0.25) {
      // Коротко: 1 абзац
      return { paragraphCount: 1, videoPosition: Math.random() < 0.5 ? 0 : 1 };
    } else if (roll < 0.65) {
      // Середньо: 2 абзаци, відео в одній з трьох позицій
      const pos = Math.floor(Math.random() * 3); // 0, 1, або 2
      return { paragraphCount: 2, videoPosition: pos };
    } else {
      // Довго: 3 абзаци, відео в одній з чотирьох позицій
      const pos = Math.floor(Math.random() * 4); // 0, 1, 2, або 3
      return { paragraphCount: 3, videoPosition: pos };
    }
  }

  static async generateYouTubePost(video, transcript, user = null) {
    const usePersona = !!(user?.persona && user?.prompt);
    const { paragraphCount, videoPosition } = this.#randomYouTubeLayout();

    const sourceBlock = transcript
      ? `Назва: ${video.title}\nКанал: ${video.channel}\nТранскрипт (частина): ${transcript}`
      : `Назва: ${video.title}\nКанал: ${video.channel}\nОпис: ${video.description}`;

    const paragraphWord = paragraphCount === 1 ? '1 абзац' : `${paragraphCount} абзаци`;

    const forbidden = `ЗАБОРОНЕНО:
- Говорити від імені каналу або автора: "ми знайшли", "ми розповімо", "у відео ви дізнаєтесь", "автори розкривають", "автор показує", "він пояснює"
- Прес-реліз: "В огляді представлено", "відео фокусується на", "матеріал детально розкриває"
- Слово "матеріал" для позначення відео — замість нього: відео, огляд, запис, ролик, та інші, або взагалі без назви ("тут показують", "там розбирають")
- Вступи: "Натрапив", "Знайшов", "Побачив", "Подивився"
- Будь-яке речення де підметом є відео/ролик/запис/кліп або будь-який їх синонім, а присудок описує зміст — заборонена сама конструкція, незалежно від формулювання: "Відеоролик демонструє", "Запис показує", "Ролик розкриває", "Відео містить", "Кліп пояснює", "Запис присвячений", "У цьому відео", "Цей ролик", "Відео починається з" — і будь-які інші варіації цієї схеми
- Зайві емоції: знаки оклику пачками, "це бомба", "неймовірно", "народ готуйтесь"
- Висновки: "Побачимо як воно буде", "час покаже"
- Повторювати одну думку двічі`;

    const formatting = `ФОРМАТ:
- Мова: українська.
- Тільки HTML теги <p>...</p>
- Рівно ${paragraphWord}. Не більше, не менше.
- Списки через переноси рядка всередині <p> якщо відео технічне або порівняльне
- Жодних коментарів від себе`;

    let prompt;

    if (usePersona) {
      const mood = this.#randomMood();

      prompt = `${user.prompt}

ПРАВИЛА ПОВЕДІНКИ:
- ТИ НЕ АСИСТЕНТ. Ти — реальний користувач форуму.
- НІЯКОЇ ВВІЧЛИВОСТІ: Не дякуй, не вітайся, не пропонуй допомогу.
- Не треба ідеальної граматики — пропущена кома або крапка це норма для соцмережі.

НАСТРІЙ: ${mood}

${forbidden}

${formatting}

${sourceBlock}`;
    } else if (Math.random() < 0.5) {
      // Варіант А: живий — як звичайний юзер ділиться відео
      prompt = `Ти — звичайний учасник авто-спільноти, ділишся відео. Пиши як людина, не як редакція.

Стиль — орієнтуйся на ці приклади:
"Купівля б/у авто це завжди лотерея якщо не знаєш на що дивитись. Тут непогано розжовано: кузов, освітлення при огляді, як поводитись з продавцем. Базово але корисно."
"Yangwang U9\n4 мотори, кожне колесо під контролем\nРозгін до 100 — 2 секунди\n1000+ к.с.\n\nДивно що про це майже ніхто не говорить."
"Nürburgring 24h це окремий вайб. Не про ідеальні кола — про хаос, погоду і ніч. Тут не завжди перемагає найшвидший."

${forbidden}

${formatting}

${sourceBlock}`;
    } else {
      // Варіант Б: стриманий саммарі — інформаційно, без зайвих емоцій
      prompt = `Напиши короткий інформаційний пост про це відео для авто-спільноти. Стиль — стриманий, по суті, без зайвих емоцій.

${forbidden}
- Також заборонено: розмовні вступи, звернення до читача ("ти", "вам")

Починай одразу з теми. Факти, суть, що цікавого у відео — і все.

${formatting}

${sourceBlock}`;
    }

    const content = GeminiService.#deduplicateParagraphs(await this.#generate(prompt));
    const embed   = `<div data-youtube-video=""><iframe width="640" height="480" allowfullscreen="true" autoplay="false" disablekbcontrols="false" enableiframeapi="false" endtime="0" ivloadpolicy="0" loop="false" modestbranding="false" origin="" playlist="" progressbarcolor="white" rel="1" src="https://www.youtube.com/embed/${video.videoId}?color=white&amp;rel=1" start="0"></iframe></div>`;

    const paragraphs = content.split('</p>').filter(p => p.trim()).map(p => p + '</p>');

    // Вставляємо embed у вибрану позицію
    paragraphs.splice(videoPosition, 0, embed);
    return paragraphs.join('\n');
  }

  /**
   * Генерує підпис для відео-story на основі назви та каналу Short-відео.
   */
  static async generateVideoStory(user, videoTitle, channelName) {
    const hasPersona = !!(user?.persona && user?.prompt);

    let prompt;
    if (hasPersona) {
      prompt = `${user.prompt}

Напиши дуже короткий підпис (1-2 речення) для story з автомобільним відео.
Відео: "${videoTitle}" від каналу "${channelName}".
Пиши як звичайна людина, що ділиться класним відосом — невимушено, без офіціозу.
Тільки текст, без HTML тегів, без лапок навколо.`;
    } else {
      prompt = `Напиши короткий підпис (1-2 речення) для story з відео: "${videoTitle}" від каналу "${channelName}".
Стиль: невимушений, автомобільна тематика. Тільки текст, без HTML.`;
    }

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
   * Перевіряє чи стаття відповідає тематиці конкретної спільноти.
   * Використовується замість isAutoRelated при зборі контенту для спільнот.
   *
   * @param {string} title         — заголовок статті
   * @param {string} summary       — короткий зміст
   * @param {string} communityName — назва спільноти (для контексту)
   */
  static async isCommunityRelated(title, summary, communityName) {
    const prompt = `You are a content moderator for the community "${communityName}".

Is the following article directly relevant to this community's topic?
Answer YES if the article is clearly about the main topic of this community.
Answer NO if it's only tangentially related or off-topic.

Return ONLY "YES" or "NO". No other text.

Title: ${title}
Summary: ${summary}

Result:`.trim();

    try {
      const text = await this.#generate(prompt);
      return text.toUpperCase().includes('YES');
    } catch {
      return true;
    }
  }

  /**
   * Генерує пост від імені спільноти на основі статті.
   * Використовує community.prompt як системну інструкцію.
   *
   * @param {object} article   — стаття з черги
   * @param {object} community — об'єкт спільноти з полем prompt
   */
  static async generateCommunityPost(article, community) {
    const newsBlock = `Заголовок: ${article.title}\n${article.summary ? `Деталі: ${article.summary}` : ''}`;

    const mood = this.#randomMood();

    const roll = Math.random();
    let lengthInstruction;
    if (roll < CONTENT.shortPostChance) {
      lengthInstruction = 'ДОВЖИНА — КОРОТКО: рівно 1 абзац, максимум 3-4 речення. Більше — заборонено.';
    } else if (roll < CONTENT.shortPostChance + CONTENT.mediumPostChance) {
      lengthInstruction = 'ДОВЖИНА — СЕРЕДНЬО: 2 абзаци. Не більше.';
    } else {
      lengthInstruction = 'ДОВЖИНА — ДЕТАЛЬНО: 3 абзаци. Не більше.';
    }

    const prompt = `${community.prompt}

ПРАВИЛА:
- Пишеш від імені редакції спільноти, не від конкретної людини.
- Тільки факти з інфоприводу — не вигадуй деталей.
- Не використовуй кліше: "цікаво", "варто зазначити", "не можна не відмітити".
- Починай одразу з теми — без вступних слів.
- ОДНОРАЗОВІСТЬ: Не повторюй одну думку двічі.

НАСТРІЙ ЦЬОГО ПОСТА: ${mood}

ФОРМАТ:
- Тільки HTML теги <p>...</p>
- Жодних коментарів від нейронки, жодних лапок навколо тексту.
- Жодних префіксів типу "Ось ваш пост:"

${newsBlock}

${lengthInstruction}`;

    let content = GeminiService.#deduplicateParagraphs(await this.#generate(prompt));

    const lang = this.#detectLang(content);
    content = content.trimEnd() + '\n' + randomLinkBlock(article.url, lang);

    return content;
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
