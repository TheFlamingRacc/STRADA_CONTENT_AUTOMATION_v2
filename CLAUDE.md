# 🚗 STRADA CONTENT BOT — Паспорт проекту
### Версія 2.1 | Для Claude Code

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
│   ├── publishYouTube.js     — Публікація YouTube постів
│   ├── publishStories.js     — Публікація сторіс
│   └── engagementJob.js      — Запуск лайків і збережень
├── services/
│   ├── AuthService.js        — Логін і отримання JWT токена
│   ├── PostService.js        — CRUD постів, завантаження фото на CDN
│   ├── StoryService.js       — Публікація і перегляд сторіс
│   ├── EngagementService.js  — Лайки, збереження, перегляд сторіс
│   ├── RssService.js         — Парсинг RSS, фільтрація фото
│   ├── GeminiService.js      — Генерація тексту, переклад, аналіз
│   └── YouTubeService.js     — Відео з каналів, транскрипт, YouTube embed
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
- Валідовані фото кешуються в `data/img_cache/` — при публікації завантажуються з диску без повторного fetch
- При прунінгу черги (статті старше тижня) і при відсіві кандидатів що не ввійшли в ліміт — кеш-файли видаляються автоматично
- Додає **вигадані теми** (`data/invented_topics.json`) з імовірністю `INVENTED_TOPIC_CHANCE` (30%)
- Зберігає чергу в `data/articles_queue.json` (Railway Volume або локально)
- **Ліміт:** до `MAX_NEW_ARTICLES` (30) нових статей за збір

### 3.2 Публікація постів (`publishPosts`)
- Для кожного слоту з `DailyScheduler` вибирається юзер-автор
- Стаття підбирається у пріоритеті: `UserProfiler.findRelevantArticle` → `matchByPrompt` (за ключовими словами з промпту) → зважена вибірка за кількістю фото
- Статті з більшою кількістю фото мають вищий шанс бути вибраними; статті без фото виходять рідко (~15%)
- `publishedInSession` (in-memory Set) захищає від повторної публікації однієї статті в межах поточного процесу
- **Gemini** генерує пост від імені персонажа з `user.prompt` (характер, мова, стиль, рандомний настрій)
- Рандомна довжина поста: короткий (1 абзац), середній (2 абзаци), довгий (3 абзаци)
- Посилання на джерело додається програмно (не через Gemini) з визначенням мови тексту (uk/ru)
- Із шансом `YOUTUBE_IN_POST_CHANCE` (40%) підбирається YouTube відео за темою статті через `findVideo`; відео перевіряється по `youtube_published.json` щоб не повторюватись, і після вставки фіксується там
- Фото завантажується на **Strada CDN** з локального кешу (`imagePaths`); vision-перевірка вже пройдена на етапі збору — тут тільки MIME type і розмір
- Пост спочатку зберігається як чернетка (`/profile/drafts`), потім публікується (`/profile/posts`)
- HTML формат: `<p>...</p>` з можливістю вставки `<img>` і посилань

### 3.3 YouTube пости (`publishYouTube`)
- YouTube пости **замішуються в звичайний розклад**: з шансом `YOUTUBE_POST_CHANCE` (35%) черговий пост публікується як YouTube замість RSS статті
- Публікується від юзера **зі слоту розкладу** (не рандомного)
- **Алгоритм вибору відео** (`findRandomAutoVideo`):
  1. Перемішує список каналів з `data/youtube_channels.json`
  2. Для кожного каналу: завантажує 20 останніх відео через **uploads playlist** (1 unit замість 100 для search)
  3. Фільтр по назві: відсіює `#shorts`, `#short`, промо-ключові слова (telegram, тг, ексклюзив в, підпишись на, тощо)
  4. Батч-перевірка тривалості через `videos.list` (ще 1 unit на всі кандидати): відхиляє < 90с (Shorts/реклама) і > 20 хв
  5. Перший валідний результат з доступним thumbnail — повертається
  6. Якщо жоден канал не дав результату — повертає null (без fallback на весь YouTube)
- Всі 17 каналів у списку автомобільні — тематичний пошук не потрібен
- Квота: ~2 units на канал (1 playlist + 1 videos.list) замість 100 units раніше
- Отримання транскрипту через `youtube-transcript` (npm, без API ключа): спочатку `uk`, потім `en` як fallback
- Якщо транскрипт недоступний — використовується опис відео
- **Gemini** генерує пост в режимі персонажа (persona) або редактора: по суті, без вступів "Відеоролик демонструє / У відео показано"
- Embed формат: `<div data-youtube-video=""><iframe ... src="https://www.youtube.com/embed/{id}?color=white&rel=1" ...></iframe></div>` — виявлений з network trace Strada
- Embed вставляється у рандомну позицію між абзацами (визначається `#randomYouTubeLayout`)
- Опубліковані відео фіксуються в `data/youtube_published.json` (ліміт 500 записів) — запобігає повторам як у standalone YouTube постах, так і у вбудованих відео RSS постів
- `YOUTUBE_API_KEY` потрібен для `findRandomAutoVideo` і `findVideo`; транскрипт — без ключа

### 3.4 Публікація сторіс (`publishStories`)
- Щодня о 12:00 (Київ)
- Кількість сторіс: від `STORIES_PER_DAY_MIN` до `STORIES_PER_DAY_MAX` (2-5)
- **Gemini** генерує короткий текст 1-2 речення від імені персонажа
- Базується на актуальних автоновинах з черги

### 3.5 Engagement (симуляція активності)
- Запускається **рандомну кількість разів на день** (`ENGAGEMENT_RUNS_PER_DAY_MIN`–`MAX`, 4–7), у рандомний час в межах активних годин — ніяких фіксованих cron-часів
- Слоти генеруються при старті бота і щоночі о 00:01 разом з розкладом постів; слоти що вже минули — відкидаються
- **Одна сесія = один рандомний юзер, одна взаємодія** (лайк або збереження)
- Алгоритм: логін → завантаження до `ENGAGEMENT_FEED_PAGES` сторінок `/feed/all` (по `ENGAGEMENT_FEED_PER_PAGE` постів) → вибір дії (збереження з шансом `SAVE_CHANCE`, інакше лайк) → фільтр: тільки пости де `is_liked: false` або `saved_post: false` — це per-user поля, бот не повторює свої дії → рандомний вибір посту → дія → логаут
- Якщо немає кандидатів для основної дії — автоматично пробує протилежну
- Discord: одне повідомлення на кожну взаємодію — хто, що зробив, посилання на пост, через скільки наступна взаємодія (Discord dynamic timestamp `<t:X:R>`)
- Ендпоінти: `POST /interactions/post/{uuid}/like` і `POST /interactions/post/{uuid}/save`

### 3.6 Пул ботів (мультиакаунтність)
- Масив юзерів передається через `USERS_JSON` (env) або `data/users.json`
- Кожен юзер має: `id`, `username`, `email`, `password`, `character_name`, `prompt`
- `prompt` — системна інструкція для Gemini: хто цей персонаж, як говорить, чим цікавиться
- При публікації юзери розподіляються по слотах розкладу рівномірно з перемішуванням
- Для engagement кожна сесія вибирає одного рандомного юзера з усього пулу

### 3.7 Планувальник (`DailyScheduler`)
- О **00:01** (Київ) генерується розклад на новий день — пости і engagement-слоти
- Рандомна кількість постів: `POSTS_PER_DAY_MIN`–`POSTS_PER_DAY_MAX` (18–22)
- Рандомна кількість engagement-сесій: `ENGAGEMENT_RUNS_PER_DAY_MIN`–`ENGAGEMENT_RUNS_PER_DAY_MAX` (4–7)
- Активні години для всіх: `ACTIVE_HOUR_START`–`ACTIVE_HOUR_END` (8:00–23:00 Київ)
- Cron перевіряє поточну хвилину щохвилини → якщо є слот → запускає відповідну задачу
- При колізії (два слоти на одну хвилину) — перший спрацьовує, решта відкидаються з попередженням у лог
- Discord-повідомлення з розкладом містить прогрес-бар постів і прогрес-бар взаємодій
- Лог статусу кожні 30 хвилин

---

## 4. ЗОВНІШНІ ІНТЕГРАЦІЇ

| Сервіс | Ключ | Використання |
|--------|------|-------------|
| **Strada API** | `BASE_URL`, `AUTOMATION_KEY`, JWT | Всі дії на платформі |
| **Google Gemini 2.5 Flash** | `GEMINI_KEYS` (масив) | Генерація, переклад, класифікація |
| **YouTube Data API v3** | `YOUTUBE_API_KEY` | Вибір відео з каналів, пошук відео за темою статті |
| **Discord Webhook** | `DISCORD_WEBHOOK_URL` | Логування подій і помилок |
| **RSS-фіди** | — | Автоматичний збір новин |

### Strada API ендпоінти
```
POST   /auth/sign-in                       — отримати JWT
POST   /media/upload                       — завантажити фото на CDN
POST   /profile/drafts                     — створити чернетку поста
POST   /profile/posts                      — опублікувати пост
POST   /profile/stories                    — опублікувати сторіс
POST   /interactions/post/:uuid/like       — лайкнути пост
POST   /interactions/post/:uuid/save       — зберегти пост
GET    /feed/all?page=N&per_page=21        — стрічка (пости + інше, з пагінацією)
GET    /feed/stories                       — активні сторіси
POST   /stories/:uuid/view                 — позначити сторіс як переглянуту
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
SAVE_CHANCE=0.3                    # Шанс зберегти замість лайку (0.0–1.0)
ENGAGEMENT_RUNS_PER_DAY_MIN=4      # Мін. кількість сесій на день
ENGAGEMENT_RUNS_PER_DAY_MAX=7      # Макс. кількість сесій на день
ENGAGEMENT_FEED_PAGES=3            # Скільки сторінок стрічки завантажувати (навантаження)
ENGAGEMENT_FEED_PER_PAGE=21        # Постів на сторінку

# === YOUTUBE ПОСТИ ===
YOUTUBE_POSTS_ENABLED=true
YOUTUBE_POST_CHANCE=0.35           # Шанс що черговий пост буде YouTube (0.0–1.0)

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

### `data/articles_queue.json` (черга статей)
```json
[
  {
    "id": "1712345678-ab3cd",
    "title": "Нова Toyota GR86 2025: що змінилось",
    "summary": "Детальний огляд оновленої моделі...",
    "url": "https://motor1.com/...",
    "imageUrl": "https://cdn.motor1.com/photo.jpg",
    "imageUrls": ["https://cdn.motor1.com/photo.jpg", "https://cdn.motor1.com/photo2.jpg"],
    "imagePaths": ["/data/img_cache/1712345678-ab3c.jpeg", null],
    "source": "https://www.motor1.com/rss/news/all/",
    "used": false,
    "collected_at": "2025-04-10T12:00:00.000Z"
  }
]
```

`imagePaths` — локальний кеш фото (паралельно до `imageUrls`). `null` якщо кеш недоступний (мережева помилка при зборі). При публікації зчитується з диску; після завантаження на CDN файл видаляється.

### `data/youtube_channels.json`
Список перевірених YouTube каналів (17 каналів). Редагується вручну, комітиться в репо.  
Для додавання каналу: Channel ID на YouTube (Про канал → три крапки → Поділитись → Копіювати ідентифікатор) або через YouTube API: `GET /youtube/v3/channels?part=id&forHandle=@HANDLE&key=KEY`.

### `data/youtube_published.json`
Масив video ID вже опублікованих відео (ліміт 500, старі видаляються). Запобігає повторам як у standalone YouTube постах, так і у вбудованих відео RSS постів.

---

## 7. РОЗГОРТАННЯ НА RAILWAY

### Кроки деплою
```bash
# 1. Підключити репозиторій до Railway
# 2. Додати Volume → змонтувати в /data → DATA_DIR=/data
# 3. Заповнити всі env змінні в Railway Dashboard
# 4. Deploy — Railway запустить: npm start → node src/index.js
```

### Файли в репо (не потребують Railway Volume)
- `data/youtube_channels.json` — список YouTube каналів
- `data/invented_topics.json` — теми для вигаданих постів

### Команди для ручного запуску (Railway shell / локально)
```bash
npm run collect             # Зібрати нові статті з RSS
npm run publish             # Опублікувати один пост
npm run youtube             # Опублікувати один YouTube пост вручну
npm run stories             # Опублікувати сторіси
npm run engagement          # Запустити одну engagement-сесію вручну
npm run test-publish        # Тестова публікація N постів без затримок (default: 3)
npm run test-publish 5      # Тестова публікація 5 постів
npm run test-collect        # Тестовий збір з переглядом результатів (default: 5)
npm run test-collect 10     # Тестовий збір 10 статей
npm run test-engagement     # Тестовий engagement: 3 взаємодії (default)
npm run test-engagement 10  # Тестовий engagement: 10 взаємодій
npm run test-youtube        # Тестова публікація YouTube постів (default: 3)
npm run test-youtube 10     # Тестова публікація 10 YouTube постів
npm start                   # Запустити весь бот (cron режим)
```

---

## 8. CRON РОЗКЛАД

| Час (Київ) | Задача |
|------------|--------|
| Щохвилини | Перевірка слотів постів і engagement |
| 00:01 | Генерація розкладу постів + engagement-слотів на новий день |
| 03:00 | Оновлення профілів юзерів (UserProfiler) |
| 05:00 | Збір RSS статей (вибір топ-N за кількістю фото) |
| Рандомно 4–7 разів | Engagement-сесія (рандомний час в активних годинах) |
| 35% постів | YouTube пост замість RSS (вбудовано в звичайний розклад) |
| 12:00 | Публікація сторіс |

---

## 9. ЛОГІКА БЕЗПЕКИ / АНТИВИЯВЛЕННЯ

- **Ротація ключів Gemini:** `GeminiKeyManager` перебирає ключі по колу, маркує відмовлені (`markFailed`), повторює запит до 25 разів з наростаючою затримкою
- **Рандомізація часу:** всі слоти публікацій генеруються з рандомним часом (год:хв) в межах активних годин
- **Колізія слотів:** якщо два пости потрапляють на одну хвилину — перший публікується, решта відкидаються з попередженням
- **Рандомізація авторів:** юзери перемішуються при кожній генерації розкладу
- **Рандомний час engagement:** 4–7 сесій на день у рандомний час в активних годинах — не фіксовані cron-часи
- **1 взаємодія на сесію:** кожен слот = один рандомний юзер, одна дія
- **Дедуплікація статей:** `publishedInSession` (in-memory Set) + `article.used` у файлі черги
- **Дедуплікація YouTube відео:** `youtube_published.json` відстежує всі опубліковані відео — і standalone YouTube пости, і відео вбудовані в RSS пости
- **Фільтрація контенту:** Gemini відсіює не-авто статті; при зборі — Vision-перевірка кожного фото (один раз); PostService при публікації — тільки MIME type і розмір
- **Фільтрація YouTube:** відхиляються Shorts, рекламні кліпи (keyword filter), відео < 90с або > 20 хв (duration check)
- **Чернетка перед публікацією:** двоетапна публікація (draft → publish) як на реальній платформі

---

## 10. ВІДОМІ ОБМЕЖЕННЯ І МІСЦЯ ДЛЯ ПОКРАЩЕННЯ

| # | Проблема | Рекомендоване рішення |
|---|----------|----------------------|
| 1 | Черга зберігається у JSON файлі — не масштабується | Мігрувати на SQLite або Postgres |
| 2 | Немає дедуплікації тем між юзерами — різні боти можуть опублікувати одну тему | `publishedInSession` захищає лише в межах одного процесу; між перезапусками дублі можливі |
| 3 | RSS фіди hardcoded у `RssService.js` | Перенести в окремий JSON файл аналогічно до youtube_channels.json |
| 4 | `UserProfiler` потребує накопичення публікацій — `findRelevantArticle` ефективний тільки після ~3 постів від юзера | — |
| 5 | Немає моніторингу квоти YouTube API | Quota значно знижена (playlist замість search), але явного лічильника немає |
| 6 | `data/invented_topics.json` не оновлюється автоматично | Генерувати нові теми через Gemini раз на тиждень |

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
  "rss-parser": "^3.13.0",             // Парсинг RSS/Atom фідів
  "youtube-transcript": "*"            // Транскрипти YouTube без API ключа
}
```

**Node.js:** 18+ (через ESM `import/export` і `node-fetch` v3)

---

*Актуально на: квітень 2026.*
