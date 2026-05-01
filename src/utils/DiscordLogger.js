import { DISCORD } from "../config.js";
import { getTimeUntil, formatTime, toDiscordUnix } from "./timeUtils.js";

const COLORS = {
  info:    0x5865f2,
  success: 0x57f287,
  warn:    0xfee75c,
  error:   0xed4245,
  white:   0xffffff,
};

const SITE_URL  = process.env.ENV_URL  ?? '';
const ADMIN_URL = process.env.BASE_URL ?? '';

export default class DiscordLogger {
  // Зберігаємо ID повідомлення розкладу щоб дописувати туди взаємодії
  static #scheduleMessageId   = null;
  static #scheduleBaseDesc    = '';   // базовий контент розкладу (без взаємодій)
  static #engagementLog       = [];   // [{emoji, characterName, postUrl}]
  static #communityLog        = [];   // [{icon, communityName, postUrl}]
  static #communityTotal      = 0;

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
   * Надсилає повідомлення з кількома embed-ами різних кольорів.
   * embeds: [{ level, title, description, fields }, ...]
   */
  static async sendMulti(embeds = []) {
    if (!DISCORD.webhookUrl) return;
    if (DISCORD.logLevel === "none") return;
    if (DISCORD.logLevel === "error") return;
    try {
      await fetch(DISCORD.webhookUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          embeds: embeds.map(e => this.#embed(e.level, e.title, e.description ?? "", e.fields ?? [])),
        }),
      });
    } catch {
      // мовчки
    }
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
  static scheduleGenerated(schedule, engagementCount = 0, firstEngagementTime = null, communitySlots = []) {
    // Скидаємо всі логи при новому розкладі
    this.#engagementLog     = [];
    this.#communityLog      = [];
    this.#communityTotal    = communitySlots.length;
    this.#scheduleMessageId = null;
    this.#scheduleBaseDesc  = '';

    if (!schedule.length && !communitySlots.length) {
      return this.warn("📅 Розклад порожній", "Жодного поста не заплановано на сьогодні");
    }

    const postBar = this.#progressBar(0, schedule.length);
    const lines   = schedule.map(
      (s, i) => `\`${String(i + 1).padStart(2, "0")}.\` **${formatTime(s.time)}** — ${s.user.character_name}`,
    );

    const nextSlot = schedule[0];
    const nextLine = nextSlot
      ? `⏭️ Перший пост через **${getTimeUntil(nextSlot.time)}** (${formatTime(nextSlot.time)})`
      : '';

    let description = `📝 **Пости — ${schedule.length}**\n\`${postBar}\`\n\n${lines.join("\n")}`;
    if (nextLine) description += `\n\n${nextLine}`;

    if (engagementCount > 0) {
      const engBar  = this.#progressBar(0, engagementCount);
      const engNext = firstEngagementTime
        ? `⏭️ Перша взаємодія <t:${toDiscordUnix(firstEngagementTime)}:R> (${formatTime(firstEngagementTime)})`
        : '';
      description += `\n\n👍 **Взаємодії — ${engagementCount}**\n\`${engBar}\``;
      if (engNext) description += `\n${engNext}`;
    }

    if (communitySlots.length > 0) {
      const comBar   = this.#progressBar(0, communitySlots.length);
      const firstCom = communitySlots[0];
      const comNext  = firstCom
        ? `⏭️ Перший пост спільноти через **${getTimeUntil(firstCom.time)}** (${formatTime(firstCom.time)})`
        : '';
      description += `\n\n🏁 **Спільноти — ${communitySlots.length}**\n\`${comBar}\``;
      if (comNext) description += `\n${comNext}`;
    }

    this.#scheduleBaseDesc = description;

    // Зберігаємо message ID для подальшого дописування взаємодій і постів спільнот
    this.send("info", "📅 Розклад на сьогодні", description, [], { returnId: true })
      .then(id => { if (id) this.#scheduleMessageId = id; });
  }

  /**
   * Фіксує опублікований пост спільноти в повідомленні розкладу.
   * Аналог engagementInteraction — оновлює то ж саме повідомлення.
   */
  static communityInteraction(community, type, postUuid, nextSlotTime = null) {
    const icon    = type === 'youtube' ? '📺' : '📰';
    const postUrl = `${SITE_URL}/groups/${community.slug}?publication=${postUuid}&type=post`;

    this.#communityLog.push({ icon, communityName: community.name, postUrl });

    if (!this.#scheduleMessageId) {
      const nextLine = nextSlotTime
        ? `⏭️ Наступний пост спільноти <t:${toDiscordUnix(nextSlotTime)}:R>`
        : '📭 Постів спільноти більше немає';
      return this.info(
        '',
        `${icon} **${community.name}** — [пост](${postUrl})\n${nextLine}`,
      );
    }

    const comLines = this.#communityLog.map(
      e => `${e.icon} **${e.communityName}** — [пост](${e.postUrl})`,
    );

    const comBar  = this.#progressBar(this.#communityLog.length, this.#communityTotal);
    const nextLine = nextSlotTime
      ? `\n⏭️ Наступний <t:${toDiscordUnix(nextSlotTime)}:R>`
      : '';

    const comSection = `\n\n🏁 **Спільноти — ${this.#communityLog.length}/${this.#communityTotal}**\n\`${comBar}\`\n${comLines.join('\n')}${nextLine}`;

    let fullDesc = this.#scheduleBaseDesc + comSection;
    if (this.#engagementLog.length > 0) {
      const engLines = this.#engagementLog.map(
        e => `${e.actionEmoji} **${e.characterName}** ${e.actionLabel} [пост](${e.postUrl})`,
      );
      fullDesc += `\n\n👍 **Виконано взаємодій — ${engLines.length}**\n${engLines.join('\n')}`;
    }

    if ([...fullDesc].length > 4096) fullDesc = [...fullDesc].slice(0, 4096).join('');

    return this.editMessage(this.#scheduleMessageId, 'info', '📅 Розклад на сьогодні', fullDesc);
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

    const imgs     = imageCount ?? (article.imageUrls?.length || (article.imageUrl ? 1 : 0));
    const imgField = imgs > 0 ? `🖼️ ${imgs}` : "—";

    return this.sendMulti([
      {
        level: "info",
        title: `📰 ${user.character_name}`,
      },
      {
        level:       "success",
        title:       "",
        description: [
          `**${article.title}**`,
          `🔗 [Відкрити пост](${postUrl})`,
          `🛠️ [Адмінка](${adminUrl})`,
          "",
          nextLine,
        ].join("\n"),
        fields: [
          { name: "Джерело", value: sourceName, inline: true },
          { name: "Фото",    value: imgField,   inline: true },
        ],
      },
    ]);
  }

  static youtubePostPublished(user, video, postUuid, nextSlot = null) {
    const postUrl  = `${SITE_URL}/?publication=${postUuid}&type=post`;
    const adminUrl = `${ADMIN_URL}admin/posts/~/${postUuid}`;

    const nextLine = nextSlot
      ? `⏭️ Наступний пост через **${getTimeUntil(nextSlot.time)}** — ${nextSlot.user.character_name} (${formatTime(nextSlot.time)})`
      : "📭 Постів на сьогодні більше немає";

    return this.sendMulti([
      {
        level:       "error",
        title:       `🎬 YouTube пост — ${user.character_name}`,
        description: "",
      },
      {
        level:       "success",
        title:       "",
        description: [
          `**${video.title}**`,
          `📺 ${video.channel}`,
          `🔗 [Відкрити пост](${postUrl})`,
          `🛠️ [Адмінка](${adminUrl})`,
          "",
          nextLine,
        ].join("\n"),
        fields: [
          { name: "Канал", value: video.channel,                          inline: true },
          { name: "Відео", value: `[посилання](${video.url})`, inline: true },
        ],
      },
    ]);
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
   * Додає взаємодію до розкладу (редагує повідомлення розкладу).
   * Якщо ID розкладу недоступний — fallback на окреме повідомлення.
   */
  static engagementInteraction(characterName, action, postUuid, nextSlotTime = null) {
    const actionEmoji = action === 'save' ? '💾' : '❤️';
    const actionLabel = action === 'save' ? 'зберіг' : 'вподобав';
    const postUrl     = `${SITE_URL}/?publication=${postUuid}&type=post`;

    // Додаємо в лог
    this.#engagementLog.push({ actionEmoji, actionLabel, characterName, postUrl });

    if (!this.#scheduleMessageId) {
      // Fallback: немає ID повідомлення розкладу (наприклад, перезапуск бота)
      const nextLine = nextSlotTime
        ? `⏭️ Наступна взаємодія <t:${toDiscordUnix(nextSlotTime)}:R> (${formatTime(nextSlotTime)})`
        : '📭 Взаємодій на сьогодні більше немає';
      return this.info(
        '',
        `${actionEmoji} **${characterName}** ${actionLabel} [пост](${postUrl})\n${nextLine}`,
      );
    }

    // Формуємо рядки взаємодій
    const engLines = this.#engagementLog.map(
      e => `${e.actionEmoji} **${e.characterName}** ${e.actionLabel} [пост](${e.postUrl})`,
    );

    const nextLine = nextSlotTime
      ? `\n⏭️ Наступна взаємодія <t:${toDiscordUnix(nextSlotTime)}:R> (${formatTime(nextSlotTime)})`
      : '';

    let fullDesc = this.#scheduleBaseDesc;

    // Додаємо community-блок якщо є
    if (this.#communityLog.length > 0) {
      const comLines = this.#communityLog.map(
        e => `${e.icon} **${e.communityName}** — [пост](${e.postUrl})`,
      );
      const comBar = this.#progressBar(this.#communityLog.length, this.#communityTotal);
      fullDesc += `\n\n🏁 **Спільноти — ${this.#communityLog.length}/${this.#communityTotal}**\n\`${comBar}\`\n${comLines.join('\n')}`;
    }

    const engSection = `\n\n👍 **Виконано взаємодій — ${engLines.length}**\n${engLines.join('\n')}${nextLine}`;
    fullDesc += engSection;

    if ([...fullDesc].length > 4096) fullDesc = [...fullDesc].slice(0, 4096).join('');

    return this.editMessage(this.#scheduleMessageId, 'info', '📅 Розклад на сьогодні', fullDesc);
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

  // ─── Тестова публікація YouTube (з живим прогресом) ──────────────────────────

  static testYouTubeStarted(total) {
    const bar = this.#progressBar(0, total);
    return this.send(
      "warn",
      "🧪 Тест YouTube постів",
      `\`${bar}\`\n· ${new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}`,
      [],
      { returnId: true },
    );
  }

  static testYouTubeProgress(messageId, current, total, characterName, videoTitle) {
    const bar      = this.#progressBar(current, total);
    const lastLine = characterName
      ? `✓ **${characterName}** — ${(videoTitle ?? "").slice(0, 70)}`
      : "";
    return this.editMessage(
      messageId,
      "warn",
      `🧪 YouTube тест: ${current} / ${total}`,
      `\`${bar}\`\n${lastLine}`,
    );
  }

  static async testYouTubeFinished(messageId, count, success, failed) {
    const level = failed > 0 ? "warn" : "success";
    const title = failed > 0
      ? `🧪 YouTube тест завершено: ${success} ✅ ${failed} ❌`
      : `🧪 YouTube тест завершено: ${success} постів опубліковано`;

    await this.editMessage(messageId, level, title, "");

    return this.send(
      level,
      `🧪 YouTube тест ${count} пост${count === 1 ? 'у' : 'ів'} завершено`,
      failed > 0
        ? `Успішно: **${success}**, помилок: **${failed}**`
        : `Всі **${success}** пости опубліковані успішно`,
    );
  }

  // ─── Спільноти ───────────────────────────────────────────────────────────────

  static communityPostPublished(community, article, postUuid, nextSlot = null, imageCount = null) {
    const postUrl = `${SITE_URL}/groups/${community.slug}?publication=${postUuid}&type=post`;

    let sourceName = "—";
    if (article.source) {
      try { sourceName = new URL(article.source).hostname; } catch { sourceName = article.source; }
    }

    const nextIcon = nextSlot?.type === 'youtube' ? '📺' : '📰';
    const nextLine = nextSlot
      ? `⏭️ Наступний ${nextIcon} через **${getTimeUntil(nextSlot.time)}** — ${nextSlot.community?.name ?? '—'} (${formatTime(nextSlot.time)})`
      : "📭 Постів спільноти на сьогодні більше немає";

    const imgs     = imageCount ?? (article.imageUrls?.length || (article.imageUrl ? 1 : 0));
    const imgField = imgs > 0 ? `🖼️ ${imgs}` : "—";

    return this.sendMulti([
      { level: "white", title: `📰 ${community.name}` },
      {
        level:       "success",
        title:       "",
        description: [
          `**${article.title}**`,
          `🔗 [Відкрити пост](${postUrl})`,
          "",
          nextLine,
        ].join("\n"),
        fields: [
          { name: "Джерело", value: sourceName, inline: true },
          { name: "Фото",    value: imgField,   inline: true },
        ],
      },
    ]);
  }

  static communityYouTubePostPublished(community, video, postUuid, nextSlot = null) {
    const postUrl = `${SITE_URL}/groups/${community.slug}?publication=${postUuid}&type=post`;

    const nextIcon = nextSlot?.type === 'youtube' ? '📺' : '📰';
    const nextLine = nextSlot
      ? `⏭️ Наступний ${nextIcon} через **${getTimeUntil(nextSlot.time)}** — ${nextSlot.community?.name ?? '—'} (${formatTime(nextSlot.time)})`
      : "📭 Постів спільноти на сьогодні більше немає";

    return this.sendMulti([
      { level: "white", title: `📺 ${community.name}` },
      {
        level:       "success",
        title:       "",
        description: [
          `**${video.title}**`,
          `📺 ${video.channel}`,
          `🔗 [Відкрити пост](${postUrl})`,
          "",
          nextLine,
        ].join("\n"),
        fields: [
          { name: "Канал", value: video.channel,                     inline: true },
          { name: "Відео", value: `[посилання](${video.url})`, inline: true },
        ],
      },
    ]);
  }

  static communityPostFailed(community, errMessage) {
    return this.error(
      `❌ Помилка публікації — ${community.name}`,
      `\`${errMessage}\``,
    );
  }

  // ─── Тестова публікація спільнот ─────────────────────────────────────────────

  static testCommunityPublishStarted(total, communityName) {
    const bar = this.#progressBar(0, total);
    return this.send(
      "warn",
      `🧪 Тест публікацій [${communityName}]`,
      `\`${bar}\`\n· ${new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}`,
      [],
      { returnId: true },
    );
  }

  static testCommunityPublishProgress(messageId, current, total, communityName, articleTitle) {
    const bar      = this.#progressBar(current, total);
    const lastLine = articleTitle ? `✓ ${articleTitle.slice(0, 80)}` : "";
    return this.editMessage(
      messageId,
      "warn",
      `🧪 [${communityName}]: ${current} / ${total}`,
      `\`${bar}\`\n${lastLine}`,
    );
  }

  static async testCommunityPublishFinished(messageId, count, success, failed, communityName) {
    const level = failed > 0 ? "warn" : "success";
    const title = failed > 0
      ? `🧪 [${communityName}] тест: ${success} ✅ ${failed} ❌`
      : `🧪 [${communityName}] тест: ${success} опубліковано`;

    await this.editMessage(messageId, level, title, "");

    return this.send(
      level,
      `🧪 Тест спільноти [${communityName}] — ${count} пост${count === 1 ? 'а' : 'ів'}`,
      failed > 0
        ? `Успішно: **${success}**, помилок: **${failed}**`
        : `Всі **${success}** пости опубліковані успішно`,
    );
  }

  // ─── Збір спільнот ───────────────────────────────────────────────────────────

  static collectCommunityStarted(communityName, limit) {
    const bar = this.#progressBar(0, limit);
    return this.send(
      "info",
      `📰 Збір [${communityName}] розпочато`,
      `\`${bar}\`\nЗбираємо нові статті...`,
      [],
      { returnId: true },
    );
  }

  static collectCommunityProgress(messageId, communityName, current, total, lastTitle = "") {
    const bar  = this.#progressBar(current, total);
    const last = lastTitle ? `\n✓ ${lastTitle.slice(0, 80)}` : "";
    return this.editMessage(
      messageId,
      "info",
      `📰 [${communityName}]: ${current} / ${total}`,
      `\`${bar}\`${last}`,
    );
  }

  static collectCommunityFinished(messageId, communityName, added, totalInQueue) {
    if (messageId) {
      return this.editMessage(
        messageId,
        "success",
        `✅ [${communityName}] збір завершено — додано ${added}`,
        `У черзі: **${totalInQueue}**`,
        [
          { name: "Додано",   value: String(added),       inline: true },
          { name: "У черзі", value: String(totalInQueue), inline: true },
        ],
      );
    }
    return this.info(`📰 [${communityName}] збір завершено`, "", [
      { name: "Додано",   value: String(added),       inline: true },
      { name: "У черзі", value: String(totalInQueue), inline: true },
    ]);
  }
}
