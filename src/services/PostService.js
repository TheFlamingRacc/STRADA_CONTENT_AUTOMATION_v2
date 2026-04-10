import axios from 'axios';
import fetch from 'node-fetch';
import FormData from 'form-data';
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
   */
  static async uploadImageFromUrl(token, imageUrl, username) {
    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const buffer = await res.buffer();

      // Менше 20 KB — зазвичай мініатюра-сміття
      if (buffer.length < 20_480) {
        console.warn(`⚠️  Фото замале (${Math.round(buffer.length / 1024)} KB), пропускаємо`);
        return null;
      }

      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';

      const form = new FormData();
      form.append('image',      buffer, { filename: `photo.${ext}`, contentType });
      form.append('image_type', 'post');
      form.append('username',   username);

      const uploadRes = await axios.post(`${BASE_URL}/media/upload`, form, {
        headers: {
          ...form.getHeaders(),
          'X-Strada-Automation-Key': AUTOMATION_KEY,
          Authorization: `Bearer ${token}`,
        },
      });

      return uploadRes.data?.data?.url || uploadRes.data?.url || null;
    } catch (err) {
      console.warn(`⚠️  Не вдалось завантажити фото: ${err.message}`);
      return null;
    }
  }

  /**
   * Створює чернетку поста. Якщо є imageUrl — завантажує на CDN і вставляє в контент.
   */
  static async createDraft(token, content, imageUrl = null, username = null) {
    const api = createApi(token);

    let cdnUrl = null;
    if (imageUrl && username) {
      cdnUrl = await PostService.uploadImageFromUrl(token, imageUrl, username);
      if (cdnUrl) console.log(`🖼️  Фото на CDN: ${cdnUrl}`);
    }

    const finalContent = cdnUrl
      ? PostService.#injectImage(content, cdnUrl)
      : content;

    const res = await api.post('/profile/drafts', { content: finalContent });
    return { uuid: res.data.data.uuid, content: finalContent };
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
   * Лайкає пост від імені юзера.
   */
  static async likePost(token, postUuid) {
    const api = createApi(token);
    await api.post(`/posts/${postUuid}/like`);
  }

  /**
   * Зберігає пост у збереженнях юзера.
   */
  static async savePost(token, postUuid) {
    const api = createApi(token);
    await api.post(`/posts/${postUuid}/save`);
  }

  /**
   * Повертає список свіжих постів для engagement.
   */
  static async getRecentPosts(token, limit = 20) {
    const api = createApi(token);
    const res = await api.get('/feed/posts', { params: { limit } });
    return res.data?.data?.items ?? [];
  }

  // ─── Приватні утиліти ───────────────────────────────────────────────────────
  static #injectImage(content, cdnUrl) {
    const imgTag = `<p><img src="${cdnUrl}" alt="image"></p>`;
    const paragraphs = content
      .split('</p>')
      .filter(p => p.trim())
      .map(p => p + '</p>');

    if (paragraphs.length <= 1) {
      return Math.random() > 0.5 ? imgTag + content : content + imgTag;
    }

    const idx = Math.floor(Math.random() * (paragraphs.length + 1));
    paragraphs.splice(idx, 0, imgTag);
    return paragraphs.join('');
  }
}
