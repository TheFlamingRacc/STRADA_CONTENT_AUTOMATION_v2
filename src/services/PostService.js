import axios from 'axios';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';
import { BASE_URL, AUTOMATION_KEY } from '../config.js';

function createApi(token) {
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Content-Type':            'application/json',
      'X-Strada-Automation-Key': AUTOMATION_KEY,
      Authorization:             `Bearer ${token}`,
    },
  });
}

export default class PostService {
  /**
   * Завантажує фото з зовнішнього URL на Strada CDN.
   * Повертає CDN URL або null якщо фото погане/недоступне.
   * Vision-перевірка відбувається на етапі збору (collectArticles), тут — тільки розмір.
   *
   * @param {string} token    — JWT токен
   * @param {string} imageUrl — URL зображення
   * @param {string} username — username автора (для CDN)
   */
  static async uploadImageFromUrl(token, imageUrl, username, cachePath = null) {
    try {
      let buffer, contentType;

      if (cachePath && existsSync(cachePath)) {
        // Читаємо з локального кешу — жодного зовнішнього запиту
        buffer      = readFileSync(cachePath);
        const ext   = path.extname(cachePath).slice(1).toLowerCase() || 'jpeg';
        contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      } else {
        // Fallback: завантажуємо з URL (для старих записів у черзі без кешу)
        const res = await fetch(imageUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buffer      = await res.buffer();
        contentType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      }

      const ext = contentType.split('/')[1] || 'jpg';
      const form = new FormData();
      form.append('image',      buffer, { filename: `photo.${ext}`, contentType });
      form.append('image_type', 'post');
      form.append('username',   username);

      const uploadRes = await axios.post(`${BASE_URL}/media/upload`, form, {
        headers: {
          ...form.getHeaders(),
          'X-Strada-Automation-Key': AUTOMATION_KEY,
          Authorization:             `Bearer ${token}`,
        },
      });

      // Кеш більше не потрібен — видаляємо
      if (cachePath) try { unlinkSync(cachePath); } catch {}

      return uploadRes.data?.data?.url || uploadRes.data?.url || null;
    } catch (err) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.warn(`⚠️  Не вдалось завантажити фото: ${detail}`);
      return null;
    }
  }

  /**
   * Створює чернетку поста. Завантажує фото на CDN і вставляє в контент.
   * Якщо доступно кілька картинок — рандомно вирішує скільки використати (1 або 2).
   * Vision-перевірка вже пройдена на етапі збору — тут тільки завантаження на CDN.
   *
   * @param {string}   token     — JWT токен
   * @param {string}   content   — HTML-контент поста
   * @param {string[]} imageUrls — масив URL картинок (може бути порожнім)
   * @param {string}   username  — username автора
   */
  static async createDraft(token, content, imageUrls = [], imagePaths = [], username = null) {
    const api = createApi(token);

    let finalContent = content;

    if (imageUrls.length && username) {
      const cdnUrls = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const cdnUrl = await PostService.uploadImageFromUrl(
          token, imageUrls[i], username, imagePaths[i] ?? null
        );
        if (cdnUrl) {
          console.log(`🖼️  Фото на CDN: ${cdnUrl}`);
          cdnUrls.push(cdnUrl);
        }
      }

      if (cdnUrls.length) {
        finalContent = PostService.#injectImages(content, cdnUrls);
      }
    }

    const res = await api.post('/profile/drafts', { content: finalContent });
    const uploadedImages = (finalContent.match(/<img /g) || []).length;
    return { uuid: res.data.data.uuid, content: finalContent, imageCount: uploadedImages };
  }

  /**
   * Публікує чернетку.
   */
  static async publishPost(token, content, draftUuid) {
    const api = createApi(token);
    const res = await api.post('/profile/posts', { content, draft_uuid: draftUuid });
    return res.data.data.uuid;
  }

  /**
   * Публікує пост від імені спільноти (прямо, без чернетки).
   * Ендпоінт: POST /groups/{groupSlug}/posts з {content, publishAsGroup: true}.
   *
   * @param {string}   token     — JWT токен власника спільноти
   * @param {string}   content   — HTML-контент поста
   * @param {string[]} imageUrls — масив URL картинок
   * @param {string[]} imagePaths — масив шляхів до кешу (або [])
   * @param {string}   username  — username власника (для CDN)
   * @param {string}   groupSlug — slug спільноти (наприклад "formula")
   */
  static async publishGroupPost(token, content, imageUrls = [], imagePaths = [], username = null, groupSlug) {
    const api = createApi(token);

    let finalContent = content;

    if (imageUrls.length && username) {
      const cdnUrls = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const cdnUrl = await PostService.uploadImageFromUrl(
          token, imageUrls[i], username, imagePaths[i] ?? null
        );
        if (cdnUrl) {
          console.log(`🖼️  Фото на CDN: ${cdnUrl}`);
          cdnUrls.push(cdnUrl);
        }
      }
      if (cdnUrls.length) {
        finalContent = PostService.#injectImages(content, cdnUrls);
      }
    }

    const res = await api.post(`/groups/${groupSlug}/posts`, {
      content: finalContent,
      publishAsGroup: true,
    });
    const uploadedImages = (finalContent.match(/<img /g) || []).length;
    return { uuid: res.data.data.uuid, content: finalContent, imageCount: uploadedImages };
  }

  /**
   * Лайкає пост від імені юзера.
   */
  static async likePost(token, postUuid) {
    const api = createApi(token);
    await api.post(`/interactions/post/${postUuid}/like`);
  }

  /**
   * Зберігає пост у збереженнях юзера.
   */
  static async savePost(token, postUuid) {
    const api = createApi(token);
    await api.post(`/interactions/post/${postUuid}/save`);
  }

  /**
   * Повертає одну сторінку стрічки /feed/all.
   * Кожен елемент: { type, data: { uuid, is_liked, saved_post, ... } }
   */
  static async getFeedPage(token, page = 1, perPage = 21) {
    const api = createApi(token);
    const res = await api.get('/feed/all', { params: { page, per_page: perPage } });
    const body = res.data?.data ?? res.data ?? {};
    return {
      items:      body.items ?? [],
      totalPages: body.pagination?.total_pages ?? 1,
    };
  }

  // ─── Приватні утиліти ───────────────────────────────────────────────────────

  /**
   * Вставляє одну або кілька картинок у HTML-контент поста.
   * Одна картинка — рандомна позиція. Кілька — рівномірно між абзацами.
   */
  static #injectImages(content, cdnUrls) {
    if (!cdnUrls.length) return content;

    const imgTags = cdnUrls.map(url => `<img src="${url}" alt="image">`);

    const paragraphs = content
      .split('</p>')
      .filter(p => p.trim())
      .map(p => p + '</p>');

    if (paragraphs.length <= 1) {
      // Короткий пост: всі картинки перед або після
      return Math.random() > 0.5
        ? imgTags.join('') + content
        : content + imgTags.join('');
    }

    if (imgTags.length === 1) {
      // Одна картинка — рандомна позиція
      const idx = Math.floor(Math.random() * (paragraphs.length + 1));
      paragraphs.splice(idx, 0, imgTags[0]);
      return paragraphs.join('');
    }

    // Кілька картинок: 85% — всі разом в одному місці, 15% — рівномірно
    // Мінімум після першого абзацу — блок з кількох фото на початку виглядає погано
    if (Math.random() < 0.85) {
      const minIdx = Math.min(1, paragraphs.length);
      const idx    = minIdx + Math.floor(Math.random() * (paragraphs.length + 1 - minIdx));
      paragraphs.splice(idx, 0, ...imgTags);
      return paragraphs.join('');
    }

    // Рідкісний випадок: рівномірно між абзацами
    const positions = imgTags.map((_, i) =>
      Math.round(((i + 1) / (imgTags.length + 1)) * paragraphs.length)
    );
    for (let i = positions.length - 1; i >= 0; i--) {
      paragraphs.splice(positions[i], 0, imgTags[i]);
    }
    return paragraphs.join('');
  }
}
