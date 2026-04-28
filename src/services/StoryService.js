import axios from 'axios';
import FormData from 'form-data';
import { createReadStream } from 'fs';
import { BASE_URL, AUTOMATION_KEY } from '../config.js';

function authHeaders(token, extra = {}) {
  return {
    'X-Strada-Automation-Key': AUTOMATION_KEY,
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

export default class StoryService {
  /**
   * Публікує відео-story від імені юзера.
   * @param {string} token
   * @param {string} description — текст підпису
   * @param {string} videoPath  — локальний шлях до mp4 файлу
   */
  static async publishStory(token, description, videoPath) {
    const form = new FormData();
    form.append('media', createReadStream(videoPath), {
      filename:    'story.mp4',
      contentType: 'video/mp4',
    });
    form.append('description', description);

    const res = await axios.post(`${BASE_URL}/feed/stories`, form, {
      headers: authHeaders(token, form.getHeaders()),
    });
    return res.data.data.uuid;
  }

  /**
   * Повертає плаский масив активних stories з фіду.
   * API повертає групи по юзерах — flatten до одного масиву.
   * Кожен елемент: { uuid, description, is_viewed, duration, ... }
   */
  static async getActiveStories(token, perPage = 20) {
    const res = await axios.get(`${BASE_URL}/feed/stories`, {
      headers: authHeaders(token),
      params:  { page: 1, per_page: perPage, feed_type: 'all' },
    });
    const groups = res.data?.data?.items ?? [];
    return groups.flatMap(g => g.stories ?? []);
  }

  /**
   * Позначає story як переглянуту.
   */
  static async viewStory(token, storyUuid) {
    await axios.post(`${BASE_URL}/feed/stories/${storyUuid}/view`, null, {
      headers: authHeaders(token),
    });
  }

  /**
   * Лайкає story від імені юзера.
   */
  static async likeStory(token, storyUuid) {
    await axios.post(`${BASE_URL}/feed/stories/${storyUuid}/like`, null, {
      headers: authHeaders(token),
    });
  }
}
