import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { YOUTUBE_API_KEY, DATA_DIR } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

// Теми для пошуку авто-відео (ротуються рандомно)
const AUTO_TOPICS = [
  'огляд авто 2025',
  'тест-драйв',
  'кращий кросовер 2025',
  'електромобіль тест',
  'огляд б/у авто',
  'тюнінг авто',
  'позашляховик бездоріжжя',
  'суперкар огляд',
  'бюджетне авто огляд',
  'гібрид порівняння',
  'пікап огляд 2025',
  'car review 2025',
  'best SUV 2025',
  'electric car test drive',
  'sports car review',
  'drag race',
  'rally onboard',
];

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
      if (!data.items?.length) return null;

      // Відсіюємо вже опубліковані, перемішуємо щоб не брати завжди перший
      const fresh = data.items
        .filter(i => !excludeIds.includes(i.id?.videoId))
        .sort(() => Math.random() - 0.5);

      // Перебираємо кандидатів — беремо перше відео з нормальним thumbnail
      for (const item of fresh) {
        const videoId = item.id?.videoId;
        if (!videoId) continue;

        // maxresdefault повертає 404 якщо thumbnail відсутній — такі відео відкидаємо
        try {
          const thumbRes = await fetch(
            `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
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
   * Шукає відео за рандомною авто-темою серед перевірених каналів.
   * При невдачі (канал не дав результатів) — fallback на весь YouTube.
   */
  static async findRandomAutoVideo(excludeIds = []) {
    const topic    = AUTO_TOPICS[Math.floor(Math.random() * AUTO_TOPICS.length)];
    const channels = loadTrustedChannels().sort(() => Math.random() - 0.5);

    for (const channelId of channels) {
      console.log(`🎬 YouTube тема: "${topic}" | канал: ${channelId}`);
      const video = await this.findVideo(topic, channelId, excludeIds);
      if (video) return video;
      console.log('🎬 Канал не дав результатів, пробуємо наступний...');
    }

    // Всі канали вичерпані — шукаємо по всьому YouTube
    if (channels.length) console.log('🎬 Всі канали не дали результатів, шукаємо по всьому YouTube...');
    else console.log(`🎬 YouTube тема: "${topic}"`);

    return this.findVideo(topic, null, excludeIds);
  }

  /**
   * Отримує транскрипт відео.
   * Повертає рядок (перші ~3000 символів) або null якщо субтитрів немає.
   */
  static async getTranscript(videoId) {
    try {
      const items = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });
      const text  = items.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
      return text.slice(0, 3000) || null;
    } catch {
      // Немає субтитрів або відео недоступне — не критично
      return null;
    }
  }

  /**
   * Повертає HTML-блок для вставки відео в пост (Strada YouTube embed).
   */
  static videoBlock(video) {
    return `<div data-youtube-video=""><iframe width="640" height="480" allowfullscreen="true" autoplay="false" disablekbcontrols="false" enableiframeapi="false" endtime="0" ivloadpolicy="0" loop="false" modestbranding="false" origin="" playlist="" progressbarcolor="white" rel="1" src="https://www.youtube.com/embed/${video.videoId}?color=white&amp;rel=1" start="0"></iframe></div>`;
  }
}
