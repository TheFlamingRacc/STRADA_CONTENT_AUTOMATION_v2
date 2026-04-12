import { DISCORD } from "../config.js";
import { getTimeUntil, formatTime } from "./timeUtils.js";

const COLORS = {
  info:    0x5865f2,
  success: 0x57f287,
  warn:    0xfee75c,
  error:   0xed4245,
};

const SITE_URL  = process.env.ENV_URL  ?? '';
const ADMIN_URL = process.env.BASE_URL ?? '';

export default class DiscordLogger {
  static #shouldSend(level) {
    if (!DISCORD.webhookUrl) return false;
    if (DISCORD.logLevel === "none") return false;
    if (DISCORD.logLevel === "error" && level !== "error") return false;
    return true;
  }

  static #embed(level, title, description = "", fields = []) {
    return {
      title:       String(title).slice(0, 256),
      description: String(description).slice(0, 4096),
      color:       COLORS[level] ?? COLORS.info,
      fields:      fields.slice(0, 25),
      timestamp:   new Date().toISOString(),
      footer:      { text: "Strada Content Bot" },
    };
  }

  /**
   * Надсилає повідомлення у Discord.
   * Якщо returnId=true — додає ?wait=true і повертає message_id (для подальшого редагування).
   */
  static async send(level, title, description = "", fields = [], { returnId = false } = {}) {
    if (!this.#shouldSend(level)) return null;
    try {
      const url = returnId ? `${DISCORD.webhookUrl}?wait=true` : DISCORD.webhookUrl;
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ embeds: [this.#embed(level, title, description, fields)] }),
      });
      if (returnId && res.ok) {
        const data = await res.json();
        return data.id ?? null;
      }
    } catch {
      // мовчки
    }
    return null;
  }

  /**
   * Редагує раніше надіслане повідомлення за його ID.
   */
  static async editMessage(messageId, level, title, description = "", fields = []) {
    if (!DISCORD.webhookUrl || !messageId) return;
    try {
      await fetch(`${DISCORD.webhookUrl}/messages/${messageId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ embeds: [this.#embed(level, title, description, fields)] }),
      });
    } catch {
      // мовчки
    }
  }

  // ─── Shorthand-методи ────────────────────────────────────────────────────────
  static info(title, desc, fields)    { return this.send("info",    title, desc, fields); }
  static success(title, desc, fields) { return this.send("success", title, desc, fields); }
  static warn(title, desc, fields)    { return this.send("warn",    title, desc, fields); }
  static error(title, desc, fields)   { return this.send("error",   title, desc, fields); }

  // ─── Прогрес-бар ─────────────────────────────────────────────────────────────
  static #progressBar(current, total, length = 24) {
    const filled = total > 0 ? Math.round((current / total) * length) : 0;
    return `${"█".repeat(filled)}${"░".repeat(length - filled)} ${current}/${total}`;
  }

  // ─── Збір статей (з живим оновленням) ────────────────────────────────────────

  /**
   * Надсилає початкове повідомлення про старт збору.
   * Повертає message_id для подальшого редагування.
   */
  static collectStarted(limit) {
    const bar = this.#progressBar(0, limit);
    return this.send(
      "info",
      "📰 Збір статей розпочато",
      `\`${bar}\`\nЗбираємо нові статті з RSS...`,
      [],
      { returnId: true },
    );
  }

  /**
   * Оновлює прогрес збору (редагує існуюче повідомлення).
   */
  static collectProgress(messageId, current, total, lastTitle = "") {
    const bar  = this.#progressBar(current, total);
    const last = lastTitle ? `\n✓ ${lastTitle.slice(0, 80)}` : "";
    return this.editMessage(
      messageId,
      "info",
      `📰 Збір статей: ${current} / ${total}`,
      `\`${bar}\`${last}`,
    );
  }

  /**
   * Фінальне оновлення після завершення збору.
   */
  static collectFinished(messageId, added, totalInQueue) {
    if (messageId) {
      return this.editMessage(
        messageId,
        "success",
        `✅ Збір завершено — додано ${added}`,
        `У черзі готових статей: **${totalInQueue}**`,
        [
          { name: "Додано",    value: String(added),        inline: true },
          { name: "У черзі",  value: String(totalInQueue),  inline: true },
        ],
      );
    }
    // Fallback якщо message_id не отримали (наприклад, logLevel=error)
    return this.info("📰 Збір статей завершено", "", [
      { name: "Додано",   value: String(added),       inline: true },
      { name: "У черзі", value: String(totalInQueue), inline: true },
    ]);
  }

  // ─── Розклад ─────────────────────────────────────────────────────────────────
  static scheduleGenerated(schedule, engagementCount = 0) {
    if (!schedule.length) {
      return this.warn("📅 Розклад порожній", "Жодного поста не заплановано на сьогодні");
    }

    const postBar = this.#progressBar(0, schedule.length);
    const lines   = schedule.map(
      (s, i) => `\`${String(i + 1).padStart(2, "0")}.\` **${formatTime(s.time)}** — ${s.user.character_name}`,
    );

    const nextSlot = schedule[0];
    const nextLine = `⏭️ Перший пост через **${getTimeUntil(nextSlot.time)}** (${formatTime(nextSlot.time)})`;

    let description = `📝 **Пости — ${schedule.length}**\n\`${postBar}\`\n\n${lines.join("\n")}\n\n${nextLine}`;

    if (engagementCount > 0) {
      const engBar = this.#progressBar(0, engagementCount);
      description += `\n\n👍 **Взаємодії — ${engagementCount}**\n\`${engBar}\``;
    }

    return this.info("📅 Розклад на сьогодні", description);
  }

  // ─── Публікація постів ───────────────────────────────────────────────────────
  static postPublished(user, article, postUuid, nextSlot = null, imageCount = null) {
    const postUrl   = `${SITE_URL}/?publication=${postUuid}&type=post`;
    const adminUrl  = `${ADMIN_URL}admin/posts/~/${postUuid}`;

    let sourceName = "💡 Вигадано";
    if (article.source !== "invented") {
      try { sourceName = new URL(article.source).hostname; } catch { sourceName = article.source; }
    }

    const nextLine = nextSlot
      ? `⏭️ Наступний пост через **${getTimeUntil(nextSlot.time)}** — ${nextSlot.user.character_name} (${formatTime(nextSlot.time)})`
      : "📭 Постів на сьогодні більше немає";

    const description = [
      `📰 **${article.title}**`,
      `🔗 [Відкрити пост](${postUrl})`,
      `🛠️ [Адмінка](${adminUrl})`,
      "",
      nextLine,
    ].join("\n");

    const imgs     = imageCount ?? (article.imageUrls?.length || (article.imageUrl ? 1 : 0));
    const imgField = imgs > 0 ? `🖼️ ${imgs}` : "—";

    return this.success(
      `✅ Пост опубліковано — ${user.character_name}`,
      description,
      [
        { name: "Джерело", value: sourceName, inline: true },
        { name: "Фото",    value: imgField,   inline: true },
      ],
    );
  }

  static postFailed(user, article, errMessage, nextSlot = null) {
    const nextLine = nextSlot
      ? `⏭️ Наступний пост через **${getTimeUntil(nextSlot.time)}** — ${nextSlot.user.character_name} (${formatTime(nextSlot.time)})`
      : "📭 Постів на сьогодні більше немає";

    return this.error(
      `❌ Помилка публікації — ${user.character_name}`,
      `**${article?.title ?? "—"}**\n\`${errMessage}\`\n\n${nextLine}`,
    );
  }

  // ─── Інше ────────────────────────────────────────────────────────────────────
  static engagementDone(likes, saves) {
    return this.info("👍 Engagement завершено", "", [
      { name: "Лайків",    value: String(likes), inline: true },
      { name: "Збережень", value: String(saves), inline: true },
    ]);
  }

  /**
   * Надсилає повідомлення на початку сесії engagement (звичайний режим).
   */
  static engagementSessionStarted(usersCount, plannedInteractions) {
    return this.info(
      "👍 Engagement розпочато",
      `**${usersCount}** юзерів · ~**${plannedInteractions}** взаємодій`,
    );
  }

  /**
   * Окреме повідомлення на кожну взаємодію (звичайний режим).
   */
  static engagementInteraction(characterName, action, postUuid) {
    const actionEmoji = action === 'save' ? '💾' : '❤️';
    const actionLabel = action === 'save' ? 'зберіг' : 'вподобав';
    const postUrl     = `${SITE_URL}/?publication=${postUuid}&type=post`;
    return this.info(
      '',
      `${actionEmoji} **${characterName}** ${actionLabel} [пост](${postUrl})`,
    );
  }

  // ─── Тестовий engagement (з живим прогресом) ────────────────────────────────

  static engagementTestStarted(total) {
    const bar = this.#progressBar(0, total);
    return this.send(
      "warn",
      "🧪 Тест engagement",
      `\`${bar}\`\n· ${new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}`,
      [],
      { returnId: true },
    );
  }

  /**
   * @param {Array<{characterName, action, uuid}>} log — всі взаємодії накопичені з початку
   */
  static engagementTestProgress(messageId, current, total, log = []) {
    const bar   = this.#progressBar(current, total);
    const lines = log.map(({ characterName, action, uuid }) => {
      const emoji   = action === 'save' ? '💾' : '❤️';
      const postUrl = `${SITE_URL}/?publication=${uuid}&type=post`;
      return `${emoji} **${characterName}** → [пост](${postUrl})`;
    });
    const description = `\`${bar}\`\n${lines.join('\n')}`.slice(0, 4096);
    return this.editMessage(
      messageId,
      "warn",
      `🧪 Тест engagement: ${current} / ${total}`,
      description,
    );
  }

  static async engagementTestFinished(messageId, total, likes, saves) {
    const failed = total - likes - saves;
    const level  = failed > 0 ? "warn" : "success";
    const title  = `🧪 Тест engagement завершено: ${likes} ❤️  ${saves} 💾`;
    await this.editMessage(messageId, level, title, "");
    return this.send(
      level,
      `🧪 Тест engagement ${total} взаємодій завершено`,
      `Лайків: **${likes}**, збережень: **${saves}**`,
    );
  }

  static botStarted() {
    return this.success(
      "🚀 Бот запущено",
      `Strada Content Bot online · ${new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}`,
    );
  }

  // ─── Тестова публікація (з живим прогресом) ─────────────────────────────────

  /**
   * Надсилає початкове повідомлення тестової публікації.
   * Повертає message_id для подальшого редагування.
   */
  static testPublishStarted(total) {
    const bar = this.#progressBar(0, total);
    return this.send(
      "warn",
      "🧪 Тестова публікація",
      `\`${bar}\`\n· ${new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}`,
      [],
      { returnId: true },
    );
  }

  /**
   * Оновлює прогрес тестової публікації після кожного поста.
   */
  static testPublishProgress(messageId, current, total, characterName, articleTitle) {
    const bar      = this.#progressBar(current, total);
    const lastLine = characterName
      ? `✓ **${characterName}** — ${(articleTitle ?? "").slice(0, 70)}`
      : "";
    return this.editMessage(
      messageId,
      "warn",
      `🧪 Тестова публікація: ${current} / ${total}`,
      `\`${bar}\`\n${lastLine}`,
    );
  }

  /**
   * Фінальне оновлення після завершення тестової публікації.
   * Редагує прогрес-повідомлення + надсилає окреме підсумкове повідомлення.
   */
  static async testPublishFinished(messageId, count, success, failed) {
    const level = failed > 0 ? "warn" : "success";
    const title = failed > 0
      ? `🧪 Тест завершено: ${success} ✅ ${failed} ❌`
      : `🧪 Тест завершено: ${success} постів опубліковано`;

    await this.editMessage(messageId, level, title, "");

    // Окреме підсумкове повідомлення
    return this.send(
      level,
      `🧪 Тестова публікація ${count} пост${count === 1 ? 'у' : 'ів'} завершена`,
      failed > 0
        ? `Успішно: **${success}**, помилок: **${failed}**`
        : `Всі **${success}** пост${success === 1 ? ' опубліковано' : 'и опубліковані'} успішно`,
    );
  }

  static testStarted(count) {
    return this.warn(
      "🧪 Тестовий режим увімкнено",
      `Публікуємо **${count}** пост(ів) без затримок · ${new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}`,
    );
  }
}
