const TEMPLATES_UK = [
  // Нейтральні / інформативні
  (domain, url) => `<p>Джерело: ${domain} — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Оригінал на ${domain} — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Повна стаття на ${domain}: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Посилання: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p><a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${domain}</a></p>`,

  // Розмовні / живі
  (domain, url) => `<p>Читав тут: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Звідси: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Там більше деталей є: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Хто хоче деталі — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Можете самі почитати: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Хто цікавиться — ось стаття: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Взяв звідси, хто хоче — читайте: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Якщо коротко — це звідси: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,

  // З характером / іронічні
  (domain, url) => `<p>Пишуть на ${domain}, хто не вірить — перевіряйте: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Знайшов на ${domain} — залишаю тут: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Ну і посилання, бо без нього ніяк: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Хто не читав — ось: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Першоджерело: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${domain}</a></p>`,
];

const TEMPLATES_RU = [
  // Нейтральные / информативные
  (domain, url) => `<p>Источник: ${domain} — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Оригинал на ${domain} — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Полная статья на ${domain}: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Ссылка: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p><a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${domain}</a></p>`,

  // Разговорные / живые
  (domain, url) => `<p>Читал тут: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Отсюда: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Там больше деталей: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Кто хочет подробности — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Можете сами почитать: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Кому интересно — вот статья: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,

  // С характером
  (domain, url) => `<p>Пишут на ${domain}, кто не верит — проверяйте: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Нашёл на ${domain} — оставляю тут: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Ну и ссылка, куда без неё: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Кто не читал — вот: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Первоисточник: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${domain}</a></p>`,
];

/**
 * Повертає рандомний HTML-блок з посиланням на джерело.
 * @param {string} url
 * @param {'uk'|'ru'} lang — мова тексту посилання
 */
export function randomLinkBlock(url, lang = 'uk') {
  try {
    const domain    = new URL(url).hostname.replace('www.', '');
    const templates = lang === 'ru' ? TEMPLATES_RU : TEMPLATES_UK;
    const template  = templates[Math.floor(Math.random() * templates.length)];
    return template(domain, url);
  } catch {
    return `<p><a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`;
  }
}
