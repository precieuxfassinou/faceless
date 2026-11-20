import type { App } from 'obsidian';

/** Même palette et même algorithme que la Galaxie 3D : un dossier a la même couleur partout. */
export const PALETTE = ['#4CC9F0', '#F72585', '#FFD166', '#06D6A0', '#9D4EDD', '#FF8C42', '#3A86FF',
  '#FF5D8F', '#B5E48C', '#00F5D4', '#FEE440', '#C77DFF', '#FF6B6B', '#48CAE4'];
export const ROOT_COLOR = '#E0E1DD';

export function topFolder(path: string): string {
  const i = path.indexOf('/');
  return i === -1 ? '/' : path.slice(0, i);
}

/** Dossiers de premier niveau qui contiennent des notes, triés : la même liste que la galaxie. */
export function folderColors(app: App): Map<string, string> {
  const groups = [...new Set(app.vault.getMarkdownFiles().map(f => topFolder(f.path)))].sort((a, b) => a.localeCompare(b));
  const m = new Map<string, string>();
  let i = 0;
  for (const g of groups) m.set(g, g === '/' ? ROOT_COLOR : PALETTE[i++ % PALETTE.length]);
  return m;
}
