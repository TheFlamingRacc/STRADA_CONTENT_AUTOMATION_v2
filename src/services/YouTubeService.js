import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { YOUTUBE_API_KEY, DATA_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_URL       = 'https://www.googleapis.com/youtube/v3/search';
const PLAYLIST_URL     = 'https://www.googleapis.com/youtube/v3/playlistItems';
const VIDEOS_URL       = 'https://www.googleapis.com/youtube/v3/videos';

// Мінімальна і максимальна тривалість відео для публікації (секунди)
const MIN_DURATION_SEC = 90;   // коротше — Shorts або рекламний кліп
const MAX_DURATION_SEC = 1200; // довше 20 хвилин — не підходить для посту

// Ключові слова в назві відео що вказують на рекламу або промо-контент
const PROMO_KEYWORDS = [
  'telegram', ' тг ', ' tg ', 'ексклюзив в ', '#реклам', '#promo', '#ad ',
  'link in bio', 'посилання в біо', 'follow us', 'підпишись на ', 'підписуйся на ',
  'всі відео в ', 'весь контент в ', 'більше відео в ',
];

// Парсить ISO 8601 тривалість (PT1H2M3S) у секунди
function parseDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

// Завантажує список каналів з data/youtube_channels.json.
// Повертає масив channel ID.
function loadTrustedChannels() {
  const filePath = path.resolve(DATA_DIR, 'youtube_channels.json');
  // Fallback для локальної розробки якщо DATA_DIR ще не змонтований
  const fallback = path.resolve(__dirname, '../../data/youtube_channels.json');
  const target = existsSync(filePath) ? filePath : existsSync(fallback) ? fallback : null;
  if (!target) return [];
  try {
    const channels = JSON.parse(readFileSync(target, 'utf-8'));
    return channels.map(c => c.id).filter(Boolean);
  } catch {
    return [];
  }
}

export default class YouTubeService {
  static get enabled() {
    return Boolean(YOUTUBE_API_KEY);
  }

  /**
   * Шукає відео на YouTube по темі статті.
   * Якщо задано channelId — шукає в межах конкретного каналу.
   * Повертає об'єкт відео або null.
   */
  static async findVideo(query, channelId = null, excludeIds = []) {
    if (!this.enabled) return null;

    // Шукаємо тільки відео не старіші 2 років
    const publishedAfter = new Date();
    publishedAfter.setFullYear(publishedAfter.getFullYear() - 2);

    try {
      const params = new URLSearchParams({
        key:             YOUTUBE_API_KEY,
        q:               query,
        type:            'video',
        part:            'snippet',
        maxResults:      '10',
        safeSearch:      'moderate',
        videoCategoryId: '2',
        videoDuration:   'medium',
        videoDefinition: 'high',
        order:           'relevance',
        publishedAfter:  publishedAfter.toISOString(),
      });

      if (channelId) params.set('channelId', channelId);

      const res  = await fetch(`${SEARCH_URL}?${params}`);
      const data = await res.json();

      // Логуємо помилки API (квота, невалідний ключ тощо)
      if (data.error) {
        const code = data.error.code;
        const msg  = data.error.errors?.[0]?.reason ?? data.error.message;
        if (code === 403 && msg === 'quotaExceeded') {
          console.error('🚫 YouTube API: квота вичерпана на сьогодні');
        } else {
          console.warn(`⚠️  YouTube API помилка ${code}: ${msg}`);
        }
        return null;
      }

      if (!data.items?.length) return null;

      // Відсіюємо вже опубліковані, перемішуємо щоб не брати завжди перший
      const fresh = data.items
        .filter(i => !excludeIds.includes(i.id?.videoId))
        .sort(() => Math.random() - 0.5);

      // Перебираємо кандидатів — беремо перше відео з доступним thumbnail
      for (const item of fresh) {
        const videoId = item.id?.videoId;
        if (!videoId) continue;

        // hqdefault завжди присутній для будь-якого відео, на відміну від maxresdefault
        try {
          const thumbRes = await fetch(
            `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            { method: 'HEAD' },
          );
          if (!thumbRes.ok) continue;
        } catch {
          continue;
        }

        return {
          videoId,
          title:       item.snippet?.title ?? '',
          channel:     item.snippet?.channelTitle ?? '',
          channelId:   item.snippet?.channelId ?? '',
          description: (item.snippet?.description ?? '').slice(0, 300),
          url:         `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl:    `https://www.youtube.com/embed/${videoId}`,
        };
      }

      return null;
    } catch (err) {
      console.warn(`⚠️  YouTube пошук не вдався: ${err.message}`);
      return null;
    }
  }

  /**
   * Бере свіже відео з рандомного перевіреного каналу (uploads playlist).
   * Коштує 1 quota unit на канал замість 100 для search.
   * Без тематичного фільтру — всі канали в списку автомобільні.
   */
  static async findRandomAutoVideo(excludeIds = []) {
    const channels = loadTrustedChannels().sort(() => Math.random() - 0.5);

    for (const channelId of channels) {
      console.log(`🎬 YouTube канал: ${channelId}`);
      const video = await this.findVideoFromChannel(channelId, excludeIds);
      if (video) return video;
      console.log('🎬 Канал не дав результатів, пробуємо наступний...');
    }

    console.log('⚠️  Жоден канал не дав результатів');
    return null;
  }

  /**
   * Повертає рандомне свіже відео з uploads playlist каналу.
   * Відсіює: вже опубліковані, Shorts, рекламні кліпи, відео поза діапазоном тривалості.
   */
  static async findVideoFromChannel(channelId, excludeIds = []) {
    if (!this.enabled) return null;

    const uploadsPlaylistId = 'UU' + channelId.slice(2);

    try {
      // ── Крок 1: отримуємо останні 20 відео з каналу (1 unit) ─────────────────
      const playlistParams = new URLSearchParams({
        key:        YOUTUBE_API_KEY,
        playlistId: uploadsPlaylistId,
        part:       'snippet',
        maxResults: '50',
      });

      const plRes  = await fetch(`${PLAYLIST_URL}?${playlistParams}`);
      const plData = await plRes.json();

      if (plData.error) {
        const code = plData.error.code;
        const msg  = plData.error.errors?.[0]?.reason ?? plData.error.message;
        if (code === 403 && msg === 'quotaExceeded') {
          console.error('🚫 YouTube API: квота вичерпана на сьогодні');
        } else {
          console.warn(`⚠️  YouTube API помилка ${code}: ${msg}`);
        }
        return null;
      }

      if (!plData.items?.length) return null;

      // ── Крок 2: фільтр по назві (Shorts-теги і промо-ключові слова) ──────────
      const candidates = plData.items.filter(i => {
        const videoId = i.snippet?.resourceId?.videoId;
        if (!videoId || excludeIds.includes(videoId)) return false;
        const title = (i.snippet?.title ?? '').toLowerCase();
        if (title.includes('#shorts') || title.includes('#short')) return false;
        if (PROMO_KEYWORDS.some(kw => title.includes(kw))) return false;
        return true;
      });

      if (!candidates.length) return null;

      // ── Крок 3: перевіряємо тривалість батчем (1 unit на всі кандидати) ──────
      const ids = candidates.map(i => i.snippet.resourceId.videoId).join(',');
      const videoParams = new URLSearchParams({
        key:  YOUTUBE_API_KEY,
        id:   ids,
        part: 'contentDetails',
      });

      const vidRes  = await fetch(`${VIDEOS_URL}?${videoParams}`);
      const vidData = await vidRes.json();

      const durationMap = new Map();
      for (const item of vidData.items ?? []) {
        durationMap.set(item.id, parseDuration(item.contentDetails?.duration));
      }

      const valid = candidates
        .filter(i => {
          const videoId = i.snippet.resourceId.videoId;
          const dur = durationMap.get(videoId) ?? 0;
          return dur >= MIN_DURATION_SEC && dur <= MAX_DURATION_SEC;
        })
        .sort(() => Math.random() - 0.5);

      if (!valid.length) return null;

      // ── Крок 4: перший кандидат з доступним thumbnail ────────────────────────
      for (const item of valid) {
        const videoId = item.snippet.resourceId.videoId;
        try {
          const thumbRes = await fetch(
            `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            { method: 'HEAD' },
          );
          if (!thumbRes.ok) continue;
        } catch {
          continue;
        }

        return {
          videoId,
          title:       item.snippet?.title ?? '',
          channel:     item.snippet?.channelTitle ?? '',
          channelId:   item.snippet?.channelId ?? '',
          description: (item.snippet?.description ?? '').slice(0, 300),
          url:         `https://www.youtube.com/watch?v=${videoId}`,
          embedUrl:    `https://www.youtube.com/embed/${videoId}`,
        };
      }

      return null;
    } catch (err) {
      console.warn(`⚠️  YouTube playlist не вдався: ${err.message}`);
      return null;
    }
  }

  /**
   * Отримує транскрипт відео.
   * Повертає рядок (перші ~3000 символів) або null якщо субтитрів немає.
   */
  static async getTranscript(videoId) {
    // Спочатку українська, потім англійська як fallback
    for (const lang of ['uk', 'en']) {
      try {
        const items = await YoutubeTranscript.fetchTranscript(videoId, { lang });
        const text  = items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
        if (text) return text.slice(0, 3000);
      } catch {
        // Немає субтитрів для цієї мови — пробуємо наступну
      }
    }
    return null;
  }

  /**
   * Повертає HTML-блок для вставки відео в пост (Strada YouTube embed).
   */
  static videoBlock(video) {
    return `<div data-youtube-video=""><iframe width="640" height="480" allowfullscreen="true" autoplay="false" disablekbcontrols="false" enableiframeapi="false" endtime="0" ivloadpolicy="0" loop="false" modestbranding="false" origin="" playlist="" progressbarcolor="white" rel="1" src="https://www.youtube.com/embed/${video.videoId}?color=white&amp;rel=1" start="0"></iframe></div>`;
  }
}
