# 🚗 STRADA CONTENT BOT — Паспорт проекту
### Версія 2.0 | Для Claude Code

---

## 1. ОГЛЯД ПРОЕКТУ

**Назва:** Strada Content Automation Bot  
**Тип:** Автономний мультиакаунтний контент-бот для автомобільної соціальної мережі  
**Платформа:** [strada.com.ua](https://strada.com.ua) — автомобільна соціальна мережа з функціоналом продажу авто (аналог AutoRia + Instagram для автолюбителів)  
**Стек:** Node.js 18+ (ESM), Gemini 2.5 Flash, YouTube Data API v3, node-cron, Railway  
**Репозиторій:** `STRADA_CONTENT_AUTOMATION_v2-main`

---

## 2. АРХІТЕКТУРА СИСТЕМИ

```
src/
├── index.js                  — Точка входу. Cron-оркестратор всіх задач
├── config.js                 — Конфігурація (env-змінні, getUsers())
├── scheduler/
│   └── DailyScheduler.js     — Генерує денний розклад публікацій
├── jobs/
│   ├── collectArticles.js    — Збір і обробка RSS + вигадані теми
│   ├── publishPosts.js       — Публікація постів
│   ├── publishStories.js     — Публікація сторіс
│   └── engagementJob.js      — Запуск лайків і збережень
├── services/
│   ├── AuthService.js        — Логін і отримання JWT токена
│   ├── PostService.js        — CRUD постів, завантаження фото на CDN
│   ├── StoryService.js       — Публікація і перегляд сторіс
│   ├── EngagementService.js  — Лайки, збереження, перегляд сторіс
│   ├── RssService.js         — Парсинг RSS, фільтрація фото
│   ├── GeminiService.js      — Генерація тексту, переклад, аналіз
│   └── YouTubeService.js     — Пошук відео за темою
├── analytics/
│   └── UserProfiler.js       — Аналіз інтересів юзерів по опублікованих постах
└── utils/
    ├── dataStore.js          — Читання/запис черги статей (JSON файл)
    ├── DiscordLogger.js      — Логування подій у Discord webhook
    ├── GeminiKeyManager.js   — Ротація Gemini API ключів з fallback
    ├── linkTemplates.js      — HTML блоки з посиланнями на джерело
    └── timeUtils.js          — Робота з часовою зоною Київ
```

---

## 3. ФУНКЦІОНАЛЬНІ МОДУЛІ

### 3.1 Збір контенту (`collectArticles`)
- Парсить **12 RSS-фідів** (CarAndDriver, Jalopnik, Motor1, TopGear, AutoExpress, Electrek, autogeek.ua, auto.pravda.com.ua та ін.)
- Фільтрує нерелевантні статті через **Gemini** (`isAutoRelated`) — YES/NO класифікація
- Перекладає англійські статті на українську через **Gemini** (`translateArticle`) у форматі JSON
- Витягує **до 4 зображень** на статтю з RSS (`imageUrls[]` + `imageUrl` для сумісності)
- Перевіряє кожне фото через **Gemini Vision** (`isImageRelevant`) — відхиляє нерелевантні. Перевірка відбувається **один раз при зборі**, щоб не блокувати публікацію
- Зберігає лише фото >20KB і з розміром ≥400×250px
- Додає **вигадані теми** (`data/invented_topics.json`) з імовірністю `INVENTED_TOPIC_CHANCE` (30%)
- Зберігає чергу в `data/queue.json` (Railway Volume або локально)
- **Ліміт:** до `MAX_NEW_ARTICLES` (30) нових статей за збір

### 3.2 Публікація постів (`publishPosts`)
- Для кожного слоту з `DailyScheduler` вибирається юзер-автор
- Стаття підбирається у пріоритеті: `UserProfiler.findRelevantArticle` → `matchByPrompt` (за ключовими словами з промпту) → зважена вибірка за кількістю фото
- Статті з більшою кількістю фото мають вищий шанс бути вибраними; статті без фото виходять рідко (~15%)
- **Gemini** генерує пост від імені персонажа з `user.prompt` (характер, мова, стиль, рандомний настрій)
- Рандомна довжина поста: короткий (1-2 абзаци), середній (2-3), довгий (3-4)
- Посилання на джерело додається програмно (не через Gemini) з визначенням мови тексту (uk/ru)
- Із шансом `YOUTUBE_IN_POST_CHANCE` (40%) підбирається YouTube відео за темою
- Фото завантажується на **Strada CDN** і вставляється в HTML-контент (1 або 2 фото рандомно); vision-перевірка вже пройдена на етапі збору — тут тільки розмір
- Пост спочатку зберігається як чернетка (`/profile/drafts`), потім публікується (`/profile/posts`)
- HTML формат: `<p>...</p>` з можливістю вставки `<img>` і посилань

### 3.3 Публікація сторіс (`publishStories`)
- Щодня о 12:00 (Київ)
- Кількість сторіс: від `STORIES_PER_DAY_MIN` до `STORIES_PER_DAY_MAX` (2-5)
- **Gemini** генерує короткий текст 1-2 речення від імені персонажа
- Базується на актуальних автоновинах з черги

### 3.4 Engagement (симуляція активності)
- Запускається 4 рази на день: **10:00, 14:00, 18:00, 21:00** (Київ)
- Кожен раз — рандомна підмножина юзерів (половина пулу)
- Кожен юзер: тягне 30 свіжих постів зі стрічки → перемішує → лайкає `LIKES_PER_RUN` (5)
- Із шансом `SAVE_CHANCE` (30%) — зберігає пост у "збереженнях"
- Переглядає активні сторіс від імені юзера
- Затримка між діями: 3-8 сек (виглядає природно)

### 3.5 Пул ботів (мультиакаунтність)
- Масив юзерів передається через `USERS_JSON` (env) або `data/users.json`
- Кожен юзер має: `id`, `username`, `email`, `password`, `character_name`, `prompt`
- `prompt` — системний інструкція для Gemini: хто цей персонаж, як говорить, чим цікавиться
- При публікації юзери розподіляються по слотах розкладу рівномірно з перемішуванням
- Для engagement щоразу рандомно обирається підмножина юзерів

### 3.6 Планувальник (`DailyScheduler`)
- О **00:01** (Київ) генерується розклад на новий день
- Рандомна кількість постів: `POSTS_PER_DAY_MIN`-`POSTS_PER_DAY_MAX` (18-22)
- Активні години: `ACTIVE_HOUR_START`-`ACTIVE_HOUR_END` (8:00-23:00 Київ)
- Cron перевіряє поточну хвилину щохвилини → якщо є слот → запускає публікацію
- Лог статусу кожні 30 хвилин

---

## 4. ЗОВНІШНІ ІНТЕГРАЦІЇ

| Сервіс | Ключ | Використання |
|--------|------|-------------|
| **Strada API** | `BASE_URL`, `AUTOMATION_KEY`, JWT | Всі дії на платформі |
| **Google Gemini 2.5 Flash** | `GEMINI_KEYS` (масив) | Генерація, переклад, класифікація |
| **YouTube Data API v3** | `YOUTUBE_API_KEY` | Пошук відео за темою статті |
| **Discord Webhook** | `DISCORD_WEBHOOK_URL` | Логування подій і помилок |
| **RSS-фіди** | — | Автоматичний збір новин |

### Strada API ендпоінти
```
POST   /auth/login                    — отримати JWT
POST   /media/upload                  — завантажити фото на CDN
POST   /profile/drafts                — створити чернетку поста
POST   /profile/posts                 — опублікувати пост
POST   /profile/stories               — опублікувати сторіс
POST   /posts/:uuid/like              — лайкнути пост
POST   /posts/:uuid/save              — зберегти пост
GET    /feed/posts                    — стрічка постів
GET    /feed/stories                  — активні сторіси
POST   /stories/:uuid/view            — позначити сторіс як переглянуту
```

---

## 5. КОНФІГУРАЦІЯ (ENV змінні)

```env
# === ОБОВ'ЯЗКОВІ ===
BASE_URL=https://api.strada.com.ua/api/v1.0
AUTOMATION_KEY=                    # Ключ автоматизації платформи
GEMINI_KEYS=key1,key2,key3         # Кілька ключів через кому (ротація)
USERS_JSON=[{"id":1,"username":"...","email":"...","password":"...","character_name":"...","prompt":"..."}]

# === НЕОБОВ'ЯЗКОВІ ===
YOUTUBE_API_KEY=                   # YouTube Data API v3
DISCORD_WEBHOOK_URL=               # Для логування
DISCORD_LOG_LEVEL=error            # all | error | none

# === РОЗКЛАД ===
POSTS_PER_DAY_MIN=18
POSTS_PER_DAY_MAX=22
ACTIVE_HOUR_START=8
ACTIVE_HOUR_END=23

# === КОНТЕНТ ===
MAX_NEW_ARTICLES=30
INVENTED_TOPIC_CHANCE=0.3
SHORT_POST_CHANCE=0.3
MEDIUM_POST_CHANCE=0.4
YOUTUBE_IN_POST_CHANCE=0.4

# === ENGAGEMENT ===
ENGAGEMENT_ENABLED=true
LIKES_PER_RUN=5
SAVE_CHANCE=0.3
ENGAGEMENT_DELAY_MIN_MS=3000
ENGAGEMENT_DELAY_MAX_MS=8000
ENGAGEMENT_CRON=0 10,14,18,21 * * *

# === СТОРІС ===
STORIES_ENABLED=true
STORIES_PER_DAY_MIN=2
STORIES_PER_DAY_MAX=5

# === STORAGE (Railway) ===
DATA_DIR=/data                     # Шлях до Railway Volume
```

---

## 6. СТРУКТУРА ДАНИХ

### `users.json` / `USERS_JSON`
```json
[
  {
    "id": 1,
    "username": "victor_auto",
    "email": "victor@example.com",
    "password": "secret",
    "character_name": "Віктор",
    "persona": true,
    "prompt": "Ти Віктор, 38 років, механік з Харкова. Пишеш суржиком, любиш японські авто, скептично ставишся до електромобілів. Часто даєш практичні поради з обслуговування. Пишеш як у чаті — без офіціозу."
  }
]
```

### `data/queue.json` (черга статей)
```json
[
  {
    "id": "1712345678-ab3cd",
    "title": "Нова Toyota GR86 2025: що змінилось",
    "summary": "Детальний огляд оновленої моделі...",
    "url": "https://motor1.com/...",
    "imageUrl": "https://cdn.motor1.com/photo.jpg",
    "imageUrls": ["https://cdn.motor1.com/photo.jpg", "https://cdn.motor1.com/photo2.jpg"],
    "source": "https://www.motor1.com/rss/news/all/",
    "used": false,
    "collected_at": "2025-04-10T12:00:00.000Z"
  }
]
```

---

## 7. РОЗГОРТАННЯ НА RAILWAY

### Кроки деплою
```bash
# 1. Підключити репозиторій до Railway
# 2. Додати Volume → змонтувати в /data → DATA_DIR=/data
# 3. Заповнити всі env змінні в Railway Dashboard
# 4. Deploy — Railway запустить: npm start → node src/index.js
```

### Команди для ручного запуску (Railway shell / локально)
```bash
npm run collect          # Зібрати нові статті з RSS
npm run publish          # Опублікувати один пост
npm run stories          # Опублікувати сторіси
npm run engagement       # Запустити лайки/збереження
npm run test-publish     # Тестова публікація N постів без затримок (default: 3)
npm run test-publish 5   # Тестова публікація 5 постів
npm run test-collect     # Тестовий збір з переглядом результатів (default: 5)
npm run test-collect 10  # Тестовий збір 10 статей
npm start                # Запустити весь бот (cron режим)
```

---

## 8. CRON РОЗКЛАД

| Час (Київ) | Задача |
|------------|--------|
| Щохвилини | Перевірка слотів публікації постів |
| 00:01 | Генерація нового розкладу на день |
| 03:00 | Оновлення профілів юзерів (UserProfiler) |
| 10:00, 14:00, 18:00, 21:00 | Engagement (лайки, збереження, перегляд сторіс) |
| 12:00 | Публікація сторіс |

---

## 9. ЛОГІКА БЕЗПЕКИ / АНТИВИЯВЛЕННЯ

- **Ротація ключів Gemini:** `GeminiKeyManager` перебирає ключі по колу, маркує відмовлені (`markFailed`), повторює запит до 25 разів з наростаючою затримкою
- **Рандомізація часу:** всі слоти публікацій генеруються з рандомним часом (год:хв) в межах активних годин
- **Рандомізація авторів:** юзери перемішуються при кожній генерації розкладу
- **Рандомна підмножина для engagement:** щоразу лише ~50% юзерів беруть участь
- **Затримки між діями:** 3-8 сек між лайками, 6-16 сек між юзерами
- **Фільтрація контенту:** Gemini відсіює не-авто статті; при зборі — Vision-перевірка кожного фото (один раз); PostService при публікації — тільки розмір (<20KB) і пікселі (<400×250)
- **Чернетка перед публікацією:** двоетапна публікація (draft → publish) як на реальній платформі

---

## 10. ВІДОМІ ОБМЕЖЕННЯ І МІСЦЯ ДЛЯ ПОКРАЩЕННЯ

| # | Проблема | Рекомендоване рішення |
|---|----------|----------------------|
| 1 | Черга зберігається у JSON файлі — не масштабується | Мігрувати на SQLite або Postgres |
| 2 | Немає дедуплікації постів між юзерами — різні боти можуть опублікувати одну тему | Додати `publishedTitles` cache per-session |
| 3 | RSS фіди hardcoded у `RssService.js` | Перенести в конфіг або окремий JSON файл |
| 4 | `UserProfiler` аналізує інтереси — базова фільтрація за промптом працює (`matchByPrompt`), профільна (`findRelevantArticle`) потребує накопичення публікацій | — |
| 5 | Немає retry при помилці публікації поста | Додати exponential backoff аналогічно до GeminiService |
| 6 | YouTube пошук завжди з `relevanceLanguage: uk` — може не знайти відео для EN статей | Передавати мову статті як параметр |
| 7 | Немає моніторингу квоти YouTube API | Додати лічильник і throttling |
| 8 | `data/invented_topics.json` не оновлюється автоматично | Генерувати нові теми через Gemini раз на тиждень |

---

## 11. ТЕСТУВАННЯ

### Базові перевірки перед запуском
```bash
# 1. Перевірити підключення до Strada API
node -e "import('./src/services/AuthService.js').then(m => m.default.login(EMAIL, PASS).then(console.log))"

# 2. Тестовий збір RSS
npm run collect

# 3. Перевірити генерацію одного поста
npm run publish

# 4. Перевірити engagement
npm run engagement
```

### Чеклист перед деплоєм
- [ ] `BASE_URL` і `AUTOMATION_KEY` заповнені
- [ ] `GEMINI_KEYS` містить хоча б один валідний ключ
- [ ] `USERS_JSON` — валідний JSON масив мінімум з 1 юзером, у кожного є `prompt`
- [ ] Railway Volume змонтований, `DATA_DIR` вказує правильно
- [ ] Discord webhook (опціонально) — якщо потрібне логування

---

## 12. ЗАЛЕЖНОСТІ

```json
{
  "@google/generative-ai": "^0.24.1",  // Gemini SDK
  "axios": "^1.6.0",                    // HTTP клієнт для Strada API
  "dotenv": "^16.0.0",                  // Завантаження .env для локального запуску
  "form-data": "^4.0.5",               // Multipart для завантаження фото
  "image-size": "^1.1.1",              // Перевірка розмірів фото без повного декоду
  "node-cron": "^3.0.3",               // Планувальник задач
  "node-fetch": "^3.3.2",              // Fetch для RSS і фото
  "rss-parser": "^3.13.0"              // Парсинг RSS/Atom фідів
}
```

**Node.js:** 18+ (через ESM `import/export` і `node-fetch` v3)

---

*Актуально на: квітень 2026.*
