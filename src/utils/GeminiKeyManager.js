import { GEMINI_KEYS } from '../config.js';

/**
 * Round-robin ротація Gemini API ключів.
 * Якщо ключ дає 429/503 — позначаємо його як тимчасово недоступний
 * і пропускаємо на cooldownMs.
 */
class GeminiKeyManager {
  #keys = [];
  #index = 0;
  #cooldowns = new Map(); // key → timestamp коли знову доступний
  #cooldownMs = 60_000;   // 1 хвилина cooldown при помилці

  constructor() {
    this.#keys = GEMINI_KEYS;
    if (this.#keys.length === 0) {
      console.error('❌ GeminiKeyManager: GEMINI_KEYS порожній!');
    }
  }

  /**
   * Повертає наступний доступний ключ.
   * Якщо всі на cooldown — повертає перший (краще спробувати, ніж впасти).
   */
  getNextKey() {
    const now = Date.now();
    const total = this.#keys.length;

    for (let i = 0; i < total; i++) {
      const idx = (this.#index + i) % total;
      const key = this.#keys[idx];
      const cooldownUntil = this.#cooldowns.get(key) ?? 0;

      if (now >= cooldownUntil) {
        this.#index = (idx + 1) % total;
        return key;
      }
    }

    // Всі на cooldown — беремо будь-який і надіємось
    console.warn('⚠️ GeminiKeyManager: всі ключі на cooldown, беремо перший');
    return this.#keys[0];
  }

  /**
   * Позначити ключ як тимчасово недоступний (після 429/503).
   */
  markFailed(key) {
    this.#cooldowns.set(key, Date.now() + this.#cooldownMs);
    console.warn(`⏳ Ключ ...${key.slice(-6)} на cooldown на ${this.#cooldownMs / 1000}с`);
  }

  get keyCount() { return this.#keys.length; }
}

export default new GeminiKeyManager();
