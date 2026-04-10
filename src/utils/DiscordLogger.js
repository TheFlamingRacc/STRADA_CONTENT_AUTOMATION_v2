import { DISCORD } from '../config.js';

const COLORS = {
  info:    0x5865F2, // синій
  success: 0x57F287, // зелений
  warn:    0xFEE75C, // жовтий
  error:   0xED4245, // червоний
};

/**
 * Логер в Discord через webhook.
 * Ніколи не кидає помилку назовні — логер не має валити бота.
 *
 * Використання:
 *   await DiscordLogger.success('Пост опубліковано', 'Назва статті', [
 *     { name: 'Автор', value: 'Віктор', inline: true },
 *   ]);
 */
export default class DiscordLogger {
  static #shouldSend(level) {
    if (!DISCORD.webhookUrl) return false;
    if (DISCORD.logLevel === 'none') return false;
    if (DISCORD.logLevel === 'error' && level !== 'error') return false;
    return true;
  }

  static async send(level, title, description = '', fields = []) {
    if (!this.#shouldSend(level)) return;

    try {
      await fetch(DISCORD.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title:       String(title).slice(0, 256),
            description: String(description).slice(0, 4096),
            color:       COLORS[level] ?? COLORS.info,
            fields:      fields.slice(0, 25), // Discord ліміт
            timestamp:   new Date().toISOString(),
            footer: { text: 'Strada Content Bot' },
          }],
        }),
      });
    } catch {
      // Мовчки — не заважаємо основному потоку
    }
  }

  // ─── Зручні шорткати ───────────────────────────────────────────────────────
  static info(title, desc, fields)    { return this.send('info',    title, desc, fields); }
  static success(title, desc, fields) { return this.send('success', title, desc, fields); }
  static warn(title, desc, fields)    { return this.send('warn',    title, desc, fields); }
  static error(title, desc, fields)   { return this.send('error',   title, desc, fields); }

  // ─── Готові шаблони для типових подій ─────────────────────────────────────
  static postPublished(user, article, postUuid) {
    return this.success('✅ Пост опубліковано', article.title, [
      { name: 'Автор',    value: user.character_name,                          inline: true },
      { name: 'UUID',     value: postUuid,                                     inline: true },
      { name: 'Джерело',  value: article.source === 'invented' ? '💡 Вигадано' : article.source, inline: false },
    ]);
  }

  static postFailed(user, article, errMessage) {
    return this.error('❌ Помилка публікації', errMessage, [
      { name: 'Автор',   value: user.character_name, inline: true },
      { name: 'Стаття',  value: article?.title ?? '—', inline: false },
    ]);
  }

  static collectDone(added, totalInQueue) {
    return this.info('📰 Збір статей завершено', '', [
      { name: 'Додано',    value: String(added),        inline: true },
      { name: 'У черзі',   value: String(totalInQueue), inline: true },
    ]);
  }

  static scheduleGenerated(count) {
    return this.info('📅 Розклад на сьогодні', `Запланованих постів: **${count}**`);
  }

  static engagementDone(likes, saves) {
    return this.info('👍 Engagement', '', [
      { name: 'Лайків',    value: String(likes), inline: true },
      { name: 'Збережень', value: String(saves), inline: true },
    ]);
  }

  static botStarted() {
    return this.success('🚀 Бот запущено', `Strada Content Bot online · ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}`);
  }
}
