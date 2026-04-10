const TEMPLATES = [
  (domain, url) => `<p>Джерело: ${domain} — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Повна стаття на ${domain}: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Читав тут: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Хто хоче деталі — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Звідси: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Оригінал на ${domain} — <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Можете самі почитати: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Посилання: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p>Там більше деталей є: <a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`,
  (domain, url) => `<p><a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${domain}</a></p>`,
];

/**
 * Повертає рандомний HTML-блок з посиланням на джерело.
 */
export function randomLinkBlock(url) {
  try {
    const domain   = new URL(url).hostname.replace('www.', '');
    const template = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
    return template(domain, url);
  } catch {
    return `<p><a target="_blank" rel="noopener noreferrer nofollow" href="${url}">${url}</a></p>`;
  }
}
