import axios from 'axios';
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

export default class StoryService {
  /**
   * Публікує story від імені юзера.
   * @param {string} token
   * @param {string} content — HTML або текст story
   * @param {string|null} imageUrl — CDN URL фото (опціонально)
   */
  static async publishStory(token, content, imageUrl = null) {
    const api = createApi(token);

    const payload = { content };
    if (imageUrl) payload.image_url = imageUrl;

    const res = await api.post('/profile/stories', payload);
    return res.data.data.uuid;
  }

  /**
   * Повертає активні stories для фіду (для engagement — перегляди).
   */
  static async getActiveStories(token, limit = 10) {
    const api = createApi(token);
    const res = await api.get('/feed/stories', { params: { limit } });
    return res.data?.data?.items ?? [];
  }

  /**
   * Позначає story як переглянуту.
   */
  static async viewStory(token, storyUuid) {
    const api = createApi(token);
    await api.post(`/stories/${storyUuid}/view`);
  }
}
