import { addIcon } from 'obsidian';
import data from './phosphor-data.json';

const ICONS = data as Record<string, string>;
export const PHOSPHOR_NAMES = Object.keys(ICONS);

/** Déclare toutes les icônes Phosphor (regular) sous le préfixe « ph- ». Viewbox Phosphor 256 → Obsidian 100. */
export function registerPhosphor() {
  for (const [name, inner] of Object.entries(ICONS)) {
    addIcon(`ph-${name}`, `<g fill="currentColor" stroke="none" transform="scale(0.390625)">${inner}</g>`);
  }
}
