/**
 * Перевірка всіх RSS та YouTube джерел у communities.json
 *
 * Використання:
 *   node src/scripts/checkSources.js             — тільки RSS
 *   node src/scripts/checkSources.js --youtube   — RSS + YouTube handle resolve (витрачає API квоту)
 */

import 'dotenv/config';
import fetch from 'node-fetch';
import { getCommunities, YOUTUBE_API_KEY } from '../config.js';

const CHECK_YOUTUBE = process.argv.includes('--youtube');
const TIMEOUT_MS    = 10_000;
const CHANNELS_URL  = 'https://www.googleapis.com/youtube/v3/channels';

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function ok(msg)   { console.log(`  ${GREEN}✅ ${msg}${RESET}`); }
function fail(msg) { console.log(`  ${RED}❌ ${msg}${RESET}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠️  ${msg}${RESET}`); }
function dim(msg)  { console.log(`${DIM}${msg}${RESET}`); }

// ─── RSS перевірка ────────────────────────────────────────────────────────────

async function checkRssFeed(feed) {
  const { url, language } = feed;
  try {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS checker)' },
    });
    clearTimeout(timeout);

    const contentType = res.headers.get('content-type') ?? '';
    const isXml  = contentType.includes('xml') || contentType.includes('rss') || contentType.includes('atom');
    const isHtml = contentType.includes('html');

    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    if (isHtml) {
      return { ok: false, reason: `повертає HTML (можливо редирект або 404-сторінка)` };
    }
    // Читаємо перший шматок щоб переконатись що це XML/RSS
    const text = await res.text();
    const isRssContent = text.includes('<rss') || text.includes('<feed') || text.includes('<channel');
    if (!isRssContent) {
      return { ok: false, reason: `контент не схожий на RSS/Atom (${contentType})` };
    }

    // Підрахуємо скільки <item> або <entry> є
    const items = (text.match(/<item[\s>]|<entry[\s>]/g) ?? []).length;
    return { ok: true, items };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, reason: 'timeout (10s)' };
    return { ok: false, reason: err.message };
  }
}

// ─── YouTube перевірка ────────────────────────────────────────────────────────

async function resolveYouTubeHandle(handle) {
  const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
  try {
    const res  = await fetch(
      `${CHANNELS_URL}?part=id,snippet&forHandle=${encodeURIComponent(cleanHandle)}&key=${YOUTUBE_API_KEY}`,
    );
    const data = await res.json();
    if (data.error) return { ok: false, reason: data.error.message };
    if (!data.items?.length) return { ok: false, reason: 'канал не знайдено' };
    return { ok: true, id: data.items[0].id, title: data.items[0].snippet?.title };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function checkYouTubeChannelId(channelId) {
  try {
    const res  = await fetch(
      `${CHANNELS_URL}?part=id,snippet&id=${channelId}&key=${YOUTUBE_API_KEY}`,
    );
    const data = await res.json();
    if (data.error) return { ok: false, reason: data.error.message };
    if (!data.items?.length) return { ok: false, reason: 'канал не знайдено' };
    return { ok: true, id: channelId, title: data.items[0].snippet?.title };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// ─── Головна логіка ───────────────────────────────────────────────────────────

async function run() {
  const communities = getCommunities();

  if (!communities.length) {
    console.error('❌ Не знайдено спільнот у communities.json / COMMUNITIES_JSON');
    process.exit(1);
  }

  console.log(`\n${BOLD}🔍 Перевірка джерел для ${communities.length} спільнот${RESET}`);
  if (CHECK_YOUTUBE && !YOUTUBE_API_KEY) {
    console.log(`${YELLOW}⚠️  YOUTUBE_API_KEY відсутній — YouTube канали не перевіряються${RESET}`);
  }
  console.log('─'.repeat(60));

  const summary = { rssOk: 0, rssFail: 0, ytOk: 0, ytFail: 0, ytSkip: 0 };

  for (const community of communities) {
    console.log(`\n${BOLD}🏁 ${community.name}${RESET} (${community.slug})`);

    // ── RSS ──────────────────────────────────────────────────────────────────
    console.log(`\n  ${BOLD}RSS (${community.rss_sources?.length ?? 0} джерел):${RESET}`);

    if (!community.rss_sources?.length) {
      warn('Немає RSS-джерел!');
    } else {
      for (const feed of community.rss_sources) {
        process.stdout.write(`  ${DIM}перевіряємо ${feed.url}...${RESET}\r`);
        const result = await checkRssFeed(feed);
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);

        const lang = feed.language ? `[${feed.language}]` : '';
        if (result.ok) {
          ok(`${lang} ${feed.url} — ${result.items} публікацій`);
          summary.rssOk++;
        } else {
          fail(`${lang} ${feed.url}\n      → ${result.reason}`);
          summary.rssFail++;
        }
      }
    }

    // ── YouTube ───────────────────────────────────────────────────────────────
    console.log(`\n  ${BOLD}YouTube (${community.youtube_channels?.length ?? 0} каналів):${RESET}`);

    if (!community.youtube_channels?.length) {
      warn('Немає YouTube каналів!');
    } else {
      for (const ch of community.youtube_channels) {
        const label = ch.name ?? ch.handle ?? ch.id;

        if (!CHECK_YOUTUBE || !YOUTUBE_API_KEY) {
          // Тільки перевірка формату
          if (ch.id) {
            if (ch.id.startsWith('UC') && ch.id.length === 24) {
              ok(`[ID] ${label}`);
              summary.ytOk++;
            } else {
              fail(`[ID] ${label} — невалідний формат ID: "${ch.id}"`);
              summary.ytFail++;
            }
          } else if (ch.handle) {
            const clean = ch.handle.startsWith('@') ? ch.handle : `@${ch.handle}`;
            ok(`[handle] ${label} ${DIM}(${clean} — не перевірено, запусти з --youtube)${RESET}`);
            summary.ytSkip++;
          } else {
            fail(`${label} — відсутні і id, і handle`);
            summary.ytFail++;
          }
          continue;
        }

        // Повна перевірка через API
        process.stdout.write(`  ${DIM}перевіряємо ${label}...${RESET}\r`);
        let result;
        if (ch.id) {
          result = await checkYouTubeChannelId(ch.id);
        } else if (ch.handle) {
          result = await resolveYouTubeHandle(ch.handle);
        } else {
          result = { ok: false, reason: 'відсутні id та handle' };
        }
        process.stdout.clearLine?.(0);
        process.stdout.cursorTo?.(0);

        if (result.ok) {
          ok(`${label} → "${result.title}" (${result.id})`);
          summary.ytOk++;
          // Якщо handle резолвився вперше — показуємо ID для кешування
          if (ch.handle && !ch.id) {
            dim(`     ↳ ID для кешування: ${result.id}`);
          }
        } else {
          fail(`${label}\n      → ${result.reason}`);
          summary.ytFail++;
        }
      }
    }
  }

  // ── Підсумок ──────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${BOLD}📊 Підсумок:${RESET}`);
  console.log(`  RSS:     ${GREEN}${summary.rssOk} ✅${RESET}  ${RED}${summary.rssFail} ❌${RESET}`);

  if (CHECK_YOUTUBE && YOUTUBE_API_KEY) {
    console.log(`  YouTube: ${GREEN}${summary.ytOk} ✅${RESET}  ${RED}${summary.ytFail} ❌${RESET}`);
  } else {
    console.log(`  YouTube: ${GREEN}${summary.ytOk} ✅${RESET}  ${summary.ytSkip > 0 ? `${YELLOW}${summary.ytSkip} handle (не перевірено)${RESET}  ` : ''}${RED}${summary.ytFail} ❌${RESET}`);
    if (summary.ytSkip > 0) {
      console.log(`  ${DIM}Запусти з --youtube щоб перевірити handle-и через API${RESET}`);
    }
  }

  const hasErrors = summary.rssFail > 0 || summary.ytFail > 0;
  console.log(`\n${hasErrors ? `${RED}${BOLD}❌ Є проблеми — перевір вище${RESET}` : `${GREEN}${BOLD}✅ Всі джерела в порядку${RESET}`}\n`);

  process.exit(hasErrors ? 1 : 0);
}

run().catch(err => {
  console.error('💥', err.message);
  process.exit(1);
});
