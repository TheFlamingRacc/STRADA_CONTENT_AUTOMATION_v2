import axios from 'axios';
import { BASE_URL, AUTOMATION_KEY } from '../config.js';

const authApi = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type':            'application/json',
    'X-Strada-Automation-Key': AUTOMATION_KEY,
  },
});

export default class AuthService {
  static #tokenCache = new Map(); // email → { token, username }

  static async login(email, password) {
    if (this.#tokenCache.has(email)) {
      return this.#tokenCache.get(email);
    }

    const response = await authApi.post('/auth/sign-in', {
      login: email,
      password,
    });

    const token    = response.data.data.access_token;
    const username = response.data.data.username;

    this.#tokenCache.set(email, { token, username });
    return { token, username };
  }

  static clearToken(email) {
    if (email) this.#tokenCache.delete(email);
    else       this.#tokenCache.clear();
  }
}
