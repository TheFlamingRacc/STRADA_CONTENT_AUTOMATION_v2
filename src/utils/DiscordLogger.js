import { DISCORD } from "../config.js";
import { getTimeUntil, formatTime } from "./timeUtils.js";

const COLORS = {
  info: 0x5865f2,
  success: 0x57f287,
  warn: 0xfee75c,
  error: 0xed4245,
};

const SITE_URL = process.env.BASE_URL;

export default class DiscordLogger {
  static #shouldSend(level) {
    if (!DISCORD.webhookUrl) return false;
    if (DISCORD.logLevel === "none") return false;
    if (DISCORD.logLevel === "error" && level !== "error") return false;
    return true;
  }

  static async send(level, title, description = "", fields = []) {
    if (!this.#shouldSend(level)) return;
    try {
      await fetch(DISCORD.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [
            {
              title: String(title).slice(0, 256),
              description: String(description).slice(0, 4096),
              color: COLORS[level] ?? COLORS.info,
              fields: fields.slice(0, 25),
              timestamp: new Date().toISOString(),
              footer: { text: "Strada Content Bot" },
            },
          ],
        }),
      });
    } catch {
      // мовчки
    }
  }

  static info(title, desc, fields) {
    return this.send("info", title, desc, fields);
  }
  static success(title, desc, fields) {
    return this.send("success", title, desc, fields);
  }
  static warn(title, desc, fields) {
    return this.send("warn", title, desc, fields);
  }
  static error(title, desc, fields) {
    return this.send("error", title, desc, fields);
  }

  /**
   * Розклад на день — одне повідомлення з усіма слотами.
   */
  static scheduleGenerated(schedule) {
    if (!schedule.length) {
      return this.warn(
        "📅 Розклад порожній",
        "Жодного поста не заплановано на сьогодні",
      );
    }

    const lines = schedule.map(
      (s, i) =>
        `\`${String(i + 1).padStart(2, "0")}.\` **${formatTime(s.time)}** — ${s.user.character_name}`,
    );

    const nextSlot = schedule[0];
    const nextLine = `\n⏭️ Перший пост через **${getTimeUntil(nextSlot.time)}** (${formatTime(nextSlot.time)})`;

    return this.info(
      `📅 Розклад на сьогодні — ${schedule.length} постів`,
      lines.join("\n") + nextLine,
    );
  }

  /**
   * Успішна публікація поста.
   */
  static postPublished(user, article, postUuid, nextSlot = null) {
    const postUrl = `${SITE_URL}/?publication=${postUuid}&type=post`;

    let sourceName = "💡 Вигадано";
    if (article.source !== "invented") {
      try {
        sourceName = new URL(article.source).hostname;
      } catch {
        sourceName = article.source;
      }
    }

    const nextLine = nextSlot
      ? `⏭️ Наступний пост через **${getTimeUntil(nextSlot.time)}** — ${nextSlot.user.character_name} (${formatTime(nextSlot.time)})`
      : "📭 Постів на сьогодні більше немає";

    const description = [
      `📰 **${article.title}**`,
      `🔗 [Відкрити пост](${postUrl})`,
      `\`${postUrl}\``,
      "",
      nextLine,
    ].join("\n");

    return this.success(
      `✅ Пост опубліковано — ${user.character_name}`,
      description,
      [{ name: "Джерело", value: sourceName, inline: true }],
    );
  }

  /**
   * Фінальна помилка публікації (після всіх спроб).
   */
  static postFailed(user, article, errMessage, nextSlot = null) {
    const nextLine = nextSlot
      ? `⏭️ Наступний пост через **${getTimeUntil(nextSlot.time)}** — ${nextSlot.user.character_name} (${formatTime(nextSlot.time)})`
      : "📭 Постів на сьогодні більше немає";

    return this.error(
      `❌ Помилка публікації — ${user.character_name}`,
      `**${article?.title ?? "—"}**\n\`${errMessage}\`\n\n${nextLine}`,
    );
  }

  static collectDone(added, totalInQueue) {
    return this.info("📰 Збір статей завершено", "", [
      { name: "Додано", value: String(added), inline: true },
      { name: "У черзі", value: String(totalInQueue), inline: true },
    ]);
  }

  static engagementDone(likes, saves) {
    return this.info("👍 Engagement", "", [
      { name: "Лайків", value: String(likes), inline: true },
      { name: "Збережень", value: String(saves), inline: true },
    ]);
  }

  static botStarted() {
    return this.success(
      "🚀 Бот запущено",
      `Strada Content Bot online · ${new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}`,
    );
  }
}
