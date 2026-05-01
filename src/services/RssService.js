import Parser from 'rss-parser';
import fetch from 'node-fetch';

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept:       'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  },
  customFields: {
    item: [
      ['media:content',   'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['image',           'image'],
      ['og:image',        'ogImage'],
    ],
  },
});

const FIXABLE_ERRORS = [
  'Attribute without value',
  'Invalid character in entity name',
  'Unquoted attribute value',
];

const JUNK_WORDS = [
  'thumb', 'small', 'tiny', 'mini', 'avatar', 'icon',
  '150x150', '100x100', '50x50', '200x150', '300x200',
  'fit-inside', 'square', 'logo', 'placeholder', 'default',
];

const FEEDS = [
  { url: 'https://www.caranddriver.com/rss/all.xml/',    lang: 'en' },
  { url: 'https://jalopnik.com/rss',                     lang: 'en' },
  { url: 'https://www.motor1.com/rss/news/all/',         lang: 'en' },
  { url: 'https://www.motorauthority.com/rss',           lang: 'en' },
  { url: 'https://www.topgear.com/rss/news/all',         lang: 'en' },
  { url: 'https://www.autoexpress.co.uk/feed/all',       lang: 'en' },
  { url: 'https://carscoops.com/feed/',                  lang: 'en' },
  { url: 'https://electrek.co/feed/',                    lang: 'en' },
  { url: 'https://www.thedrive.com/feed',                lang: 'en' },
  { url: 'https://www.autocar.co.uk/rss',                lang: 'en' },
  { url: 'https://autogeek.com.ua/feed/',                lang: 'uk' },
  { url: 'https://auto.pravda.com.ua/rss/',              lang: 'uk' },
];

function sanitizeXml(xml) {
  return xml
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;')
    .replace(/(<\w[^>]*?\s)(\w[\w-]*)(\s*\/?>)/g, (match, before, attr, end) => {
      if (/=["']/.test(match)) return match;
      return `${before}${attr}=""${end}`;
    });
}

async function parseURLWithFallback(url) {
  try {
    return await parser.parseURL(url);
  } catch (err) {
    const isFixable = FIXABLE_ERRORS.some(e => err.message.includes(e));
    if (!isFixable) throw err;

    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StradaBot/1.0)' } });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(`URL повертає HTML замість XML: ${url}`);
    }

    const raw   = await res.text();
    const clean = sanitizeXml(raw);
    return await parser.parseString(clean);
  }
}

export default class RssService {
  /**
   * Завантажує і парсить кастомний список фідів (для спільнот).
   * @param {Array<{url: string, language: string}>} feeds
   */
  static async fetchFeeds(feeds) {
    const results = [];

    for (const feed of feeds) {
      const lang = feed.language ?? feed.lang ?? 'en';
      try {
        const parsed = await parseURLWithFallback(feed.url);
        const items  = (parsed.items || []).slice(0, 10).map(item => {
          const rawImages = [];

          if      (item.enclosure?.url)         rawImages.push(item.enclosure.url);
          else if (item.mediaContent?.$?.url)   rawImages.push(item.mediaContent.$.url);
          else if (item.mediaThumbnail?.$?.url) rawImages.push(item.mediaThumbnail.$.url);

          if (item.content) {
            const imgRegex = /<img[^>]+src="([^">]+)"/g;
            let m;
            while ((m = imgRegex.exec(item.content)) !== null) {
              if (!rawImages.includes(m[1])) rawImages.push(m[1]);
            }
          }

          const imageUrls = rawImages
            .map(u => RssService.upscaleImageUrl(u))
            .filter(Boolean)
            .slice(0, 4);

          return {
            title:     item.title || '',
            summary:   item.contentSnippet || item.content || item.summary || '',
            url:       item.link || '',
            imageUrl:  imageUrls[0] || null,
            imageUrls,
            source:    feed.url,
            lang,
            date:      item.pubDate ? new Date(item.pubDate) : new Date(),
          };
        });

        results.push(...items);
        console.log(`✅ ${feed.url} — ${items.length} статей`);
      } catch (err) {
        console.warn(`⚠️  ${feed.url}: ${err.message}`);
      }
    }

    return results.sort((a, b) => b.date - a.date).slice(0, 150);
  }


  static upscaleImageUrl(url) {
    if (!url) return null;
    try {
      let clean = url.split('?')[0].split('@')[0];
      clean = clean.replace(/-\d+x\d+(\.(jpg|jpeg|png|webp|gif))$/i, '$1');
      clean = clean.replace(/_\d+(\.(jpg|jpeg|png|webp|gif))$/i, '$1');

      if (JUNK_WORDS.some(w => clean.toLowerCase().includes(w))) {
        console.log(`🚫 Фото відфільтровано: ${clean.split('/').pop()}`);
        return null;
      }

      if (clean.includes('motor1.com') || clean.includes('insideevs.com')) {
        clean = clean.replace(/\/s\d\//i, '/s1/');
      }

      return clean;
    } catch {
      return null;
    }
  }

  static async fetchAll() {
    const results = [];

    for (const feed of FEEDS) {
      try {
        const parsed = await parseURLWithFallback(feed.url);
        const items  = (parsed.items || []).slice(0, 10).map(item => {
          const rawImages = [];

          // Пріоритетне джерело: enclosure або media-теги
          if      (item.enclosure?.url)         rawImages.push(item.enclosure.url);
          else if (item.mediaContent?.$?.url)   rawImages.push(item.mediaContent.$.url);
          else if (item.mediaThumbnail?.$?.url) rawImages.push(item.mediaThumbnail.$.url);

          // Додаткові картинки з HTML-контенту статті
          if (item.content) {
            const imgRegex = /<img[^>]+src="([^">]+)"/g;
            let m;
            while ((m = imgRegex.exec(item.content)) !== null) {
              if (!rawImages.includes(m[1])) rawImages.push(m[1]);
            }
          }

          // Фільтруємо, масштабуємо, залишаємо до 4 штук
          const imageUrls = rawImages
            .map(u => RssService.upscaleImageUrl(u))
            .filter(Boolean)
            .slice(0, 4);

          return {
            title:     item.title || '',
            summary:   item.contentSnippet || item.content || item.summary || '',
            url:       item.link || '',
            imageUrl:  imageUrls[0] || null, // зворотна сумісність
            imageUrls,                        // всі картинки
            source:    feed.url,
            lang:      feed.lang,
            date:      item.pubDate ? new Date(item.pubDate) : new Date(),
          };
        });

        results.push(...items);
        console.log(`✅ ${feed.url} — ${items.length} статей`);
      } catch (err) {
        console.warn(`⚠️  ${feed.url}: ${err.message}`);
      }
    }

    return results.sort((a, b) => b.date - a.date).slice(0, 150);
  }
}
