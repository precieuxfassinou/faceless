/* Le noyau : anneaux concentriques façon réacteur. Chaque anneau porte une donnée réelle. */
import { t } from './i18n';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

/** Point sur un cercle, angle en degrés depuis midi, sens horaire. */
function polar(r: number, deg: number): [number, number] {
  const a = (deg - 90) * Math.PI / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

function arc(r: number, from: number, to: number): string {
  const [x1, y1] = polar(r, from);
  const [x2, y2] = polar(r, to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export interface ReactorData {
  segments: { name: string; sleeping: boolean }[];
  progress: number;        // 0..1, avancement cumulé des roadmaps
  caption: string;
}

export interface Reactor { svg: SVGSVGElement; pulse(): void; level(levels: number[]): void; rest(): void }

const BARS = 7;

export function buildReactor(parent: HTMLElement, data: ReactorData): Reactor {
  const svg = el('svg', { viewBox: '-150 -150 300 300', class: 'fl-reactor', role: 'img', 'aria-label': data.caption });
  parent.appendChild(svg);

  // 1. graduation extérieure, très lente
  const ticks = el('g', { class: 'fl-r-ticks' }, svg);
  for (let i = 0; i < 120; i++) {
    const long = i % 10 === 0;
    const [x1, y1] = polar(long ? 128 : 134, i * 3);
    const [x2, y2] = polar(141, i * 3);
    el('line', { x1, y1, x2, y2, class: long ? 'is-long' : '' }, ticks);
  }
  el('circle', { r: 123, class: 'fl-r-hair' }, svg);

  // 2. un segment par projet : plein si actif, éteint s'il dort
  const n = Math.max(data.segments.length, 1);
  const gap = n > 1 ? 5 : 0;
  const seg = el('g', { class: 'fl-r-segments' }, svg);
  data.segments.forEach((s, i) => {
    const from = i * 360 / n + gap / 2;
    const to = (i + 1) * 360 / n - gap / 2;
    const p = el('path', { d: arc(111, from, to), class: s.sleeping ? 'is-sleeping' : 'is-active' }, seg);
    el('title', {}, p).textContent = s.sleeping ? `${s.name} : ${t().sleepingTip}` : s.name;
  });

  // 3. avancement cumulé des roadmaps
  el('circle', { r: 95, class: 'fl-r-track' }, svg);
  const pct = Math.max(0, Math.min(1, data.progress));
  if (pct > 0.001) el('path', { d: arc(95, 0, Math.min(359.9, pct * 360)), class: 'fl-r-progress' }, svg);

  // 4. anneau pointillé, sens inverse
  el('circle', { r: 81, class: 'fl-r-dash' }, svg);
  el('circle', { r: 66, class: 'fl-r-hair' }, svg);

  // 5. la voix : une onde au centre, immobile au repos
  const wave = el('g', { class: 'fl-r-wave' }, svg);
  const bars: SVGRectElement[] = [];
  for (let i = 0; i < BARS; i++) {
    const x = (i - (BARS - 1) / 2) * 11 - 2.5;
    bars.push(el('rect', { x, y: -22, width: 5, height: 44, rx: 2.5 }, wave));
  }
  const rest = () => bars.forEach((b, i) => { b.style.transform = `scaleY(${0.14 + 0.1 * Math.sin(i * 1.3) ** 2})`; });
  rest();
  const cap = el('text', { y: 44, class: 'fl-r-caption', 'text-anchor': 'middle' }, svg);
  cap.textContent = data.caption;

  return {
    svg,
    pulse: () => bars.forEach((b, i) => {
      const centre = 1 - Math.abs(i - (BARS - 1) / 2) / BARS;
      b.style.transform = `scaleY(${(0.25 + Math.random() * 0.75 * centre).toFixed(2)})`;
    }),
    // niveaux réels de la voix (0..1 par bande), symétriques autour de la barre centrale
    level: (levels: number[]) => bars.forEach((b, i) => {
      const k = Math.abs(i - (BARS - 1) / 2);
      const v = levels[Math.min(levels.length - 1, Math.round(k * 2))] ?? 0;
      b.style.transform = `scaleY(${Math.max(0.12, Math.min(1, v * 1.8)).toFixed(2)})`;
    }),
    rest,
  };
}

/** Petit cadran circulaire : avancement d'une roadmap. */
export function buildGauge(parent: HTMLElement, pct: number | null, dim: boolean): SVGSVGElement {
  const svg = el('svg', { viewBox: '-32 -32 64 64', class: 'fl-gauge' + (dim ? ' is-dim' : '') });
  parent.appendChild(svg);
  el('circle', { r: 26, class: 'fl-g-track' }, svg);
  for (let i = 0; i < 24; i++) {
    const [x1, y1] = polar(29, i * 15);
    const [x2, y2] = polar(31, i * 15);
    el('line', { x1, y1, x2, y2, class: 'fl-g-tick' }, svg);
  }
  if (pct !== null && pct > 0.001) el('path', { d: arc(26, 0, Math.min(359.9, pct * 360)), class: 'fl-g-arc' }, svg);
  const t = el('text', { y: 4.5, 'text-anchor': 'middle', class: 'fl-g-text' }, svg);
  t.textContent = pct === null ? '—' : `${Math.round(pct * 100)}`;
  return svg;
}
