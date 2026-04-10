import { YOUTUBE_API_KEY } from '../config.js';

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

export default class YouTubeService {
  static get enabled() {
    return Boolean(YOUTUBE_API_KEY);
  }

  /**
   * Шукає відео на YouTube по темі статті.
   * Повертає { videoId, title, url } або null.
   *
   * @param {string} query — заголовок або ключові слова статті
   */
  static async findVideo(query) {
    if (!this.enabled) return null;

    try {
      const params = new URLSearchParams({
        key:        YOUTUBE_API_KEY,
        q:          query,
        type:       'video',
        part:       'snippet',
        maxResults: '5',
        relevanceLanguage: 'uk',
        safeSearch: 'moderate',
      });

      const res  = await fetch(`${SEARCH_URL}?${params}`);
      const data = await res.json();

      if (!data.items?.length) return null;

      // Беремо рандомний з топ-3 щоб не завжди перший
      const topItems = data.items.slice(0, 3);
      const item = topItems[Math.floor(Math.random() * topItems.length)];
      const videoId = item.id?.videoId;
      if (!videoId) return null;

      return {
        videoId,
        title: item.snippet?.title ?? '',
        url:   `https://www.youtube.com/watch?v=${videoId}`,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
      };
    } catch (err) {
      console.warn(`⚠️  YouTube пошук не вдався: ${err.message}`);
      return null;
    }
  }

  /**
   * Повертає HTML-блок для вставки відео в пост.
   */
  static videoBlock(video) {
    return `<p><a target="_blank" rel="noopener noreferrer nofollow" href="${video.url}">${video.title}</a></p>`;
  }
}
