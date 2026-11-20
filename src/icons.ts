import { App, FuzzySuggestModal, Menu, TAbstractFile, TFile, TFolder, debounce, setIcon } from 'obsidian';
import { folderColors, topFolder, PALETTE } from './palette';
import { PHOSPHOR_NAMES } from './phosphor';
import { t } from './i18n';
import type FacelessPlugin from './main';

export interface IconOverride { icon?: string; color?: string }

/* Icônes par mot-clé du nom de dossier (premier qui correspond). Elles décrivent le contenu, pas une métaphore. */
const FOLDER_RULES: [RegExp, string][] = [
  [/instruction/i, 'ph-terminal-window'], [/journal|daily|quotidien/i, 'ph-calendar-blank'], [/projets?-acad/i, 'ph-student'], [/inbox|bo[iî]te/i, 'ph-tray'],
  [/archive/i, 'ph-archive'], [/ressource|resource/i, 'ph-books'], [/areas?|domaines?/i, 'ph-squares-four'],
  [/[ée]tude|stud(y|ies)|school|[ée]cole/i, 'ph-graduation-cap'], [/proje[ct]t?/i, 'ph-kanban'], [/anglais|english|language|langue/i, 'ph-translate'],
  [/veille|news|reading|lecture/i, 'ph-newspaper'], [/perso/i, 'ph-user'], [/id[ée]e|idea/i, 'ph-note-pencil'], [/socle/i, 'ph-stack'],
  [/empire/i, 'ph-flag'], [/[ée]criture|writing/i, 'ph-pen-nib'], [/excalidraw|drawing/i, 'ph-scribble'], [/template|mod[eè]le/i, 'ph-copy-simple'],
  [/attachment|pi[eè]ces? jointes?|assets?|media/i, 'ph-paperclip'], [/meeting|r[ée]union/i, 'ph-users-three'],
  [/cours|course/i, 'ph-books'], [/th[eè]se|thesis|phd|papers|research|recherche/i, 'ph-flask'], [/guide/i, 'ph-map-trifold'], [/express|django/i, 'ph-hard-drives'],
  [/module/i, 'ph-puzzle-piece'], [/commun/i, 'ph-stack-simple'], [/devops/i, 'ph-shipping-container'],
  [/big data/i, 'ph-database'], [/business intelligence/i, 'ph-chart-bar'], [/machine learning/i, 'ph-graph'],
  [/qa|test/i, 'ph-check-square'], [/droit/i, 'ph-scales'], [/web|asp\.net/i, 'ph-globe-simple'],
  [/architecture/i, 'ph-tree-structure'], [/syst[eè]mes? d.information|management/i, 'ph-tree-structure'],
  [/processus/i, 'ph-flow-arrow'],
];

/* Icônes par `type:` du frontmatter */
const TYPE_RULES: Record<string, string> = {
  hub: 'ph-signpost', module: 'ph-puzzle-piece', guide: 'ph-map-trifold', veille: 'ph-newspaper', concept: 'ph-book-open',
  cours: 'ph-book-open', 'note de cours': 'ph-book-open', projet: 'ph-kanban', idée: 'ph-note-pencil', idee: 'ph-note-pencil',
  capture: 'ph-note-pencil', journal: 'ph-calendar-blank', briefing: 'ph-sun-horizon', revue: 'ph-list-checks',
  fiche: 'ph-note', 'fiche-révision': 'ph-note', glossaire: 'ph-book-bookmark', instructions: 'ph-terminal-window',
  socle: 'ph-stack', 'note-tech': 'ph-file-code', tp: 'ph-file-code', application: 'ph-file-code',
};

const KNOWN = new Set(PHOSPHOR_NAMES.map(n => `ph-${n}`));
/** Une icône choisie à la main avant Faceless (nom Lucide) reste acceptée par Obsidian. */
const pick = (name: string | undefined, fallback: string) => (name ? name : fallback);

export class IconManager {
  private colors = new Map<string, string>();
  private observers: MutationObserver[] = [];

  constructor(private app: App, private plugin: FacelessPlugin) {}

  start() {
    const applySoon = debounce(() => this.applyAll(), 150, true);
    this.app.workspace.onLayoutReady(() => {
      this.colors = folderColors(this.app);
      this.applyAll();
      this.watchExplorers(applySoon);
    });
    const recolor = debounce(() => { this.colors = folderColors(this.app); this.applyAll(); }, 500, true);
    this.plugin.registerEvent(this.app.workspace.on('layout-change', () => { this.watchExplorers(applySoon); applySoon(); }));
    this.plugin.registerEvent(this.app.vault.on('create', recolor));
    this.plugin.registerEvent(this.app.vault.on('delete', recolor));
    this.plugin.registerEvent(this.app.vault.on('rename', (file, oldPath) => { this.moveOverride(oldPath, file.path); recolor(); }));
    this.plugin.registerEvent(this.app.metadataCache.on('changed', applySoon));
    this.plugin.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => this.addMenu(menu, file)));
  }

  stop() {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
    document.querySelectorAll('.fl-icon').forEach(el => el.remove());
    document.querySelectorAll('.fl-colored-name').forEach(el => el.removeClass('fl-colored-name'));
  }

  iconFor(file: TAbstractFile): { icon: string; color: string } {
    const ov = this.plugin.settings.iconOverrides[file.path] ?? {};
    const color = ov.color ?? this.colors.get(topFolder(file.path)) ?? this.colors.get(file.path) ?? 'var(--text-muted)';
    if (file instanceof TFolder) {
      const rule = FOLDER_RULES.find(([re]) => re.test(file.name));
      return { icon: pick(ov.icon, rule?.[1] ?? 'ph-folder-simple'), color };
    }
    const f = file as TFile;
    let icon = 'ph-file-text';
    if (f.extension === 'canvas') icon = 'ph-scribble';
    else if (f.extension === 'pdf') icon = 'ph-file-pdf';
    else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(f.extension)) icon = 'ph-image';
    else if (f.name.endsWith('.excalidraw.md')) icon = 'ph-scribble';
    else if (f.extension === 'md') {
      const type = String(this.app.metadataCache.getFileCache(f)?.frontmatter?.type ?? '').toLowerCase().trim();
      if (TYPE_RULES[type]) icon = TYPE_RULES[type]!;
      else if (/hub/i.test(f.basename)) icon = 'ph-signpost';
      else if (/briefing$/i.test(f.basename)) icon = 'ph-sun-horizon';
      else if (/revue$/i.test(f.basename)) icon = 'ph-list-checks';
      else if (/^\d{4}-\d{2}-\d{2}/.test(f.basename)) icon = 'ph-calendar';
      else if (/spec|roadmap/i.test(f.basename)) icon = 'ph-file-code';
    }
    return { icon: pick(ov.icon, icon), color };
  }

  applyAll() {
    for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
      const items = (leaf.view as any)?.fileItems as Record<string, any> | undefined;   // API interne de l'explorateur
      if (!items) continue;
      for (const path in items) {
        const item = items[path];
        const self: HTMLElement | undefined = item?.selfEl ?? item?.el;
        const inner: HTMLElement | undefined = item?.innerEl;
        if (!self || !inner || !item.file) continue;
        const { icon, color } = this.iconFor(item.file);
        let el = self.querySelector(':scope > .fl-icon') as HTMLElement | null;
        if (!el) {
          el = createSpan({ cls: 'fl-icon' });
          self.insertBefore(el, inner);
        }
        const key = `${icon}|${color}`;
        if (el.dataset.key !== key) {
          el.empty();
          setIcon(el, icon);
          el.style.color = color;
          el.dataset.key = key;
        }
        const isTop = item.file instanceof TFolder && !item.file.path.includes('/');
        self.toggleClass('fl-colored-name', this.plugin.settings.colorFolderNames && isTop);
        if (item.file instanceof TFolder) self.style.setProperty('--fl-folder-color', color);
      }
    }
  }

  private watchExplorers(onChange: () => void) {
    for (const o of this.observers) o.disconnect();
    this.observers = [];
    for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
      const obs = new MutationObserver((muts) => {
        if (muts.every(m => [...m.addedNodes].every(n => (n as HTMLElement).classList?.contains('fl-icon') || n.parentElement?.classList?.contains('fl-icon')))) return;
        onChange();
      });
      obs.observe(leaf.view.containerEl, { childList: true, subtree: true });
      this.observers.push(obs);
    }
  }

  private addMenu(menu: Menu, file: TAbstractFile) {
    menu.addItem(i => i.setTitle(t().changeIcon).setIcon('ph-palette').setSection('action')
      .onClick(() => new IconPickerModal(this.app, (icon) => {
        new ColorPickerModal(this.app, this.iconFor(file).color, async (color) => {
          this.plugin.settings.iconOverrides[file.path] = { icon, color };
          await this.plugin.saveSettings();
          this.applyAll();
        }).open();
      }).open()));
    if (this.plugin.settings.iconOverrides[file.path]) {
      menu.addItem(i => i.setTitle(t().autoIcon).setIcon('ph-arrow-counter-clockwise').setSection('action')
        .onClick(async () => {
          delete this.plugin.settings.iconOverrides[file.path];
          await this.plugin.saveSettings();
          this.applyAll();
        }));
    }
  }

  private moveOverride(oldPath: string, newPath: string) {
    const o = this.plugin.settings.iconOverrides;
    let changed = false;
    for (const p of Object.keys(o)) {
      if (p === oldPath || p.startsWith(oldPath + '/')) {
        o[newPath + p.slice(oldPath.length)] = o[p]!;
        delete o[p];
        changed = true;
      }
    }
    if (changed) void this.plugin.saveSettings();
  }
}

class IconPickerModal extends FuzzySuggestModal<string> {
  constructor(app: App, private onPick: (icon: string) => void) {
    super(app);
    this.setPlaceholder(t().iconSearch);
  }
  getItems() { return [...KNOWN]; }
  getItemText(item: string) { return item.slice(3); }
  renderSuggestion(match: { item: string }, el: HTMLElement) {
    el.addClass('fl-icon-suggestion');
    const ic = el.createSpan({ cls: 'fl-icon' });
    setIcon(ic, match.item);
    el.createSpan({ text: match.item.slice(3) });
  }
  onChooseItem(item: string) { this.onPick(item); }
}

class ColorPickerModal extends FuzzySuggestModal<string> {
  constructor(app: App, private current: string, private onPick: (color: string) => void) {
    super(app);
    this.setPlaceholder(t().colorSearch);
  }
  getItems() { return [this.current, ...PALETTE.filter(c => c !== this.current), '#E0E1DD', '#9aa1cf']; }
  getItemText(item: string) { return item === this.current ? `${item} (${t().current})` : item; }
  renderSuggestion(match: { item: string }, el: HTMLElement) {
    el.addClass('fl-icon-suggestion');
    const dot = el.createSpan({ cls: 'fl-swatch' });
    dot.style.background = match.item;
    el.createSpan({ text: this.getItemText(match.item) });
  }
  onChooseItem(item: string) { this.onPick(item); }
}
