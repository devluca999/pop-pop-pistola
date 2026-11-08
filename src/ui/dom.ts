/** Tiny DOM helpers for the HTML overlay. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string | number | boolean | undefined> = {}, ...kids: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function tile(label: string, cls = ''): HTMLDivElement {
  return h('div', { class: `tile ${cls}`.trim() }, label) as HTMLDivElement;
}

/** Big shout text made of keycap tiles, e.g. POP! or FUEGO! */
export function shout(text: string, cls = ''): HTMLDivElement {
  const row = h('div', { class: `shout ${cls}`.trim() });
  for (const ch of text) row.append(tile(ch === ' ' ? '' : ch, ch === ' ' ? 'space' : ''));
  return row;
}

export function heartSvg(state: 'full' | 'cracked' | 'empty'): string {
  // 9x8 pixel heart
  const px = [
    '.XX...XX.',
    'XXXX.XXXX',
    'XXXXXXXXX',
    'XXXXXXXXX',
    '.XXXXXXX.',
    '..XXXXX..',
    '...XXX...',
    '....X....',
  ];
  const fill = state === 'empty' ? '#3a2c22' : '#d02a1c';
  let rects = '';
  px.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === 'X') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
  }));
  rects += '<rect x="1" y="1" width="1" height="1" fill="#ffb3a0" opacity="' + (state === 'empty' ? 0 : 1) + '"/>';
  if (state !== 'full') rects += '<path d="M4.5 0.5 L4 3 L5.5 4 L4.2 6.5" stroke="#1d140e" stroke-width="0.9" fill="none"/>';
  return `<svg viewBox="-0.5 -0.5 10 9" shape-rendering="crispEdges">${rects}</svg>`;
}

export function clear(el: HTMLElement) { while (el.firstChild) el.removeChild(el.firstChild); }
