/** What the tab icon signals: nothing, a session blocked on the user, a plan limit at 90% or more, or a finished session not looked at yet. */
export type FaviconBadge = 'none' | 'waiting' | 'limit' | 'done';

const BADGE_COLOR: Record<Exclude<FaviconBadge, 'none'>, string> = { waiting: '#ffe24d', limit: '#f07b72', done: '#8da2ff' };

/** A dark tile with the 2×2 grid mark, one cell lit; a dot in the corner when something wants attention. */
function faviconSvg(badge: FaviconBadge): string {
  const cell = (x: number, y: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="9" height="9" rx="2" fill="${fill}"/>`;
  const dot =
    badge === 'none'
      ? ''
      : `<circle cx="25" cy="7" r="6.5" fill="${BADGE_COLOR[badge]}" stroke="#111418" stroke-width="2.5"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="#111418"/>` +
    cell(5, 5, '#4fc58e') +
    cell(18, 5, '#9aa3ae') +
    cell(5, 18, '#9aa3ae') +
    cell(18, 18, '#9aa3ae') +
    dot +
    `</svg>`
  );
}

export function setFavicon(badge: FaviconBadge) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(badge))}`;
}
