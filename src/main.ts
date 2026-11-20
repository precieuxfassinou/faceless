import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, WorkspaceLeaf, normalizePath } from 'obsidian';
import { HomeView, HOME_VIEW } from './home';
import { IconManager, type IconOverride } from './icons';
import { registerPhosphor } from './phosphor';
import { moment, type Task } from './insights';
import { lang, obsidianLang, setLang, t, type Lang } from './i18n';
import { internals } from './internals';

interface CmView { dispatch(spec: unknown): void; state: { doc: { length: number } } }

export interface FacelessSettings {
  language: 'auto' | Lang;
  openOnStartup: boolean;
  briefingFolder: string;
  projectsFolder: string;
  instructionsFile: string;
  repriseHeading: string;
  shortcuts: string[];
  taskExcludeFolders: string[];
  resurfaceExcludeFolders: string[];
  orphanExcludeFolders: string[];
  sleepDays: number;
  deadDays: number;
  resurfaceMinDays: number;
  reviewWeekday: number;            // 1 = lundi … 7 = dimanche
  deadlines: { label: string; date: string }[];
  skinClaudian: boolean;
  themeAll: boolean;
  voiceEngine: 'natural' | 'system';
  speechRate: number;
  voiceName: string;
  autoSend: boolean;
  askPrefix: string;
  colorFolderNames: boolean;
  iconOverrides: Record<string, IconOverride>;
  keptTasks: Record<string, string>;
  resurfaced: Record<string, string>;
}

const DEFAULTS: FacelessSettings = {
  language: 'auto',
  openOnStartup: true,
  briefingFolder: '',
  projectsFolder: '',
  instructionsFile: '',
  repriseHeading: 'point de reprise|checkpoint|where i left off',
  shortcuts: [],
  taskExcludeFolders: ['Templates'],
  resurfaceExcludeFolders: ['Templates', 'Excalidraw'],
  orphanExcludeFolders: ['Templates', 'Excalidraw'],
  sleepDays: 14,
  deadDays: 30,
  resurfaceMinDays: 30,
  reviewWeekday: 5,
  deadlines: [],
  skinClaudian: true,
  themeAll: true,
  voiceEngine: 'natural',
  speechRate: 1.0,
  voiceName: '',
  autoSend: true,
  askPrefix: '',
  colorFolderNames: false,
  iconOverrides: {},
  keptTasks: {},
  resurfaced: {},
};

const CLAUDIAN_ID = 'realclaudian';
const VOICE_ID = 'faceless-voice';

/** API du module facultatif Faceless Voice (voix naturelle locale), s'il est installé. */
interface NaturalVoice {
  ready(): boolean;
  speaking: boolean;
  speak(text: string, rate: number, onLevel: (levels: number[]) => void, onEnd: () => void): void;
  stop(): void;
}
const CLAUDIAN_VIEW = 'claudian-view';
const sleep = (ms: number) => new Promise(r => window.setTimeout(r, ms));

export default class FacelessPlugin extends Plugin {
  settings: FacelessSettings = structuredClone(DEFAULTS);
  icons!: IconManager;
  private warnedVoice = false;

  async onload() {
    registerPhosphor();
    await this.loadSettings();
    this.registerView(HOME_VIEW, (leaf) => new HomeView(leaf, this));
    this.addRibbonIcon('ph-waveform', t().ribbon, () => void this.openHome());
    this.addCommand({ id: 'open', name: t().cmdOpen, callback: () => void this.openHome() });
    this.addCommand({ id: 'review', name: t().cmdReview, callback: () => void this.openReview() });
    this.addCommand({ id: 'stop-speaking', name: t().cmdStop, callback: () => this.stopSpeaking() });
    this.addSettingTab(new FacelessSettingTab(this.app, this));

    this.applySkin();
    this.registerEvent(this.app.workspace.on('window-open', (win) => this.skinBody(win.doc.body)));
    this.icons = new IconManager(this.app, this);
    this.icons.start();

    this.app.workspace.onLayoutReady(() => {
      this.detectFolders();
      if (this.settings.openOnStartup) void this.openHome();
    });
  }

  onunload() {
    this.icons?.stop();
    for (const body of this.bodies()) { body.removeClass('fl-skin-claudian'); body.removeClass('fl-theme'); }
    this.stopSpeaking();
  }

  /** Le corps de la fenêtre principale et de chaque fenêtre détachée. */
  private bodies(): HTMLElement[] {
    const docs = new Set<Document>([activeDocument]);
    this.app.workspace.iterateAllLeaves(leaf => { docs.add(leaf.view.containerEl.ownerDocument); });
    return [...docs].map(d => d.body);
  }

  applySkin() {
    for (const body of this.bodies()) this.skinBody(body);
  }

  private skinBody(body: HTMLElement) {
    body.toggleClass('fl-skin-claudian', this.settings.skinClaudian && this.hasClaudian());
    body.toggleClass('fl-theme', this.settings.themeAll);
  }

  hasClaudian(): boolean { return !!internals(this.app).plugins?.enabledPlugins?.has(CLAUDIAN_ID); }

  /** Premier lancement : devine les dossiers du journal et des projets d'après leurs noms. */
  private detectFolders() {
    const top = this.app.vault.getRoot().children.filter((c): c is TFolder => c instanceof TFolder);
    let changed = false;
    if (!this.settings.projectsFolder) {
      const f = top.find(x => /proje[ct]t?s?/i.test(x.name) && !/acad/i.test(x.name));
      if (f) { this.settings.projectsFolder = f.path; changed = true; }
    }
    if (!this.settings.briefingFolder) {
      const f = top.find(x => /journal|daily|quotidien/i.test(x.name));
      this.settings.briefingFolder = f?.path ?? 'Journal';
      changed = true;
    }
    if (!this.settings.instructionsFile) {
      const f = this.app.vault.getMarkdownFiles().find(x => x.basename === 'INDEX' && /instruction/i.test(x.parent?.name ?? ''));
      if (f) { this.settings.instructionsFile = f.path; changed = true; }
    }
    if (changed) void this.saveSettings();
  }

  /** Ouvre l'accueil sans jamais fermer d'onglet : réutilise le sien s'il existe, sinon un nouvel onglet. */
  async openHome() {
    const existing = this.app.workspace.getLeavesOfType(HOME_VIEW)[0];
    if (existing) { await this.app.workspace.revealLeaf(existing); return; }
    const leaf: WorkspaceLeaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: HOME_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /* ---------------------------------------------------------- revue de la semaine */

  async openReview() {
    const tr = t();
    const folder = normalizePath(this.settings.briefingFolder || 'Journal');
    const today = moment().format('YYYY-MM-DD');
    const path = `${folder}/${today} - ${tr.reviewFile}.md`;
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const week = moment().isoWeek();
      const body = [
        '---', `type: ${lang() === 'fr' ? 'revue' : 'review'}`, `date: ${today}`, `week: ${week}`, '---', '',
        `# ${tr.reviewTitle(week)}`, '',
        `> ${tr.reviewHint}`, '',
        ...tr.reviewQuestions.flatMap((q, i) => [`## ${i + 1}. ${q}`, '', '']),
      ].join('\n');
      file = await this.app.vault.create(path, body);
    }
    if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file);
  }

  /* ---------------------------------------------------------- tâches */

  /** Coche la tâche comme annulée (`[-]`, format du plugin Tasks) si la ligne n'a pas changé depuis l'affichage. */
  async abandonTask(task: Task) {
    let done = false;
    await this.app.vault.process(task.file, (data) => {
      const lines = data.split('\n');
      if (lines[task.line] !== task.raw) return data;
      lines[task.line] = task.raw.replace('[ ]', '[-]').replace(/\s*$/, '') + ` ❌ ${moment().format('YYYY-MM-DD')}`;
      done = true;
      return lines.join('\n');
    });
    new Notice(done ? t().taskAbandoned(task.file.basename) : t().lineChanged);
  }

  /* ---------------------------------------------------------- voix */

  /** Le module Faceless Voice, s'il est installé et activé. */
  naturalVoice(): NaturalVoice | null {
    const p = internals(this.app).plugins?.getPlugin?.(VOICE_ID) as NaturalVoice | undefined;
    return p && typeof p.speak === 'function' ? p : null;
  }

  get speaking() { return !!this.naturalVoice()?.speaking || !!window.speechSynthesis?.speaking; }

  stopSpeaking() { this.naturalVoice()?.stop(); window.speechSynthesis?.cancel(); }

  /**
   * Lit le texte. Voix naturelle si le module Faceless Voice est installé et prêt,
   * sinon voix du système dans la langue choisie.
   * onLevel reçoit les niveaux réels de la voix (voix naturelle) ou null à chaque mot (voix du système).
   */
  async speak(text: string, onEnd?: () => void, onLevel?: (levels: number[] | null) => void) {
    this.stopSpeaking();
    const end = () => onEnd?.();
    const natural = this.settings.voiceEngine === 'natural' ? this.naturalVoice() : null;
    if (natural?.ready()) {
      try {
        natural.speak(text, this.settings.speechRate, (l) => onLevel?.(l), end);
        return;
      } catch (e) {
        new Notice(t().piperFailed((e as Error).message));
      }
    }
    const synth = window.speechSynthesis;
    if (!synth) { new Notice(t().noSpeech); end(); return; }
    const voices = await systemVoices();
    const mine = voices.filter(v => v.lang?.toLowerCase().startsWith(lang()));
    const voice = voices.find(v => v.name === this.settings.voiceName) ?? mine.find(v => /paul|guy|david/i.test(v.name)) ?? mine[0];
    if (!voice) new Notice(t().noLocalVoice);
    const u = new SpeechSynthesisUtterance(text.replace(/\s+\n/g, '\n').trim());
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? (lang() === 'fr' ? 'fr-FR' : 'en-US');
    u.rate = this.settings.speechRate;
    u.onboundary = () => onLevel?.(null);
    u.onend = end;
    u.onerror = end;
    synth.speak(u);
  }

  /* ---------------------------------------------------------- Claudian (facultatif) */

  async revealClaudian(): Promise<WorkspaceLeaf | null> {
    if (!this.hasClaudian()) return null;
    let leaf = this.app.workspace.getLeavesOfType(CLAUDIAN_VIEW)[0] ?? null;
    if (!leaf) {
      // la commande de Claudian bascule la vue : on ne l'appelle que si elle n'existe pas
      internals(this.app).commands?.executeCommandById(`${CLAUDIAN_ID}:open-view`);
      for (let i = 0; i < 20 && !leaf; i++) { await sleep(150); leaf = this.app.workspace.getLeavesOfType(CLAUDIAN_VIEW)[0] ?? null; }
    }
    if (leaf) await this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  /** Écrit la question dans la zone de saisie de Claudian (éditeur CodeMirror) et l'envoie. */
  async askClaudian(question: string) {
    const prompt = `${this.settings.askPrefix || t().askPrefix}\n\n${t().question} : ${question}`;
    const leaf = await this.revealClaudian();
    let input: HTMLElement | null = null;
    for (let i = 0; i < 20 && leaf && !input; i++) {
      input = leaf.view.containerEl.querySelector(
        '.claudian-composer-editor .cm-content, .claudian-composer-editor[contenteditable="true"], .claudian-input-container textarea');
      if (!input) await sleep(150);
    }
    if (!input) {
      new Notice(t().claudianMissing, 8000);
      return;
    }
    input.focus();
    let written = false;
    if (input.instanceOf(HTMLTextAreaElement)) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, prompt);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      written = true;
    } else {
      const cm = (input as unknown as { cmView?: { view?: CmView; editorView?: CmView } }).cmView;
      const view = cm?.view ?? cm?.editorView;
      if (view?.dispatch) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: prompt }, selection: { anchor: prompt.length } });
        written = true;
      }
    }
    if (!written) {
      new Notice(t().claudianWrite, 8000);
      return;
    }
    if (this.settings.autoSend) {
      await sleep(120);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    }
  }

  /* ---------------------------------------------------------- réglages */

  async loadSettings() {
    this.settings = Object.assign(structuredClone(DEFAULTS), ((await this.loadData()) ?? {}) as Partial<FacelessSettings>);
    setLang(this.settings.language === 'auto' ? obsidianLang() : this.settings.language);
  }

  async saveSettings() { await this.saveData(this.settings); }
}

/** Les voix du système arrivent de façon asynchrone : on attend la liste avant de choisir. */
function systemVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth?.getVoices() ?? [];
  if (now.length || !synth) return Promise.resolve(now);
  return new Promise(resolve => {
    const done = () => { synth.removeEventListener('voiceschanged', done); resolve(synth.getVoices()); };
    synth.addEventListener('voiceschanged', done);
    window.setTimeout(done, 1500);
  });
}

/* ============================================================== onglet de réglages */

const L = () => lang() === 'fr' ? {
  home: 'Accueil', language: 'Langue', languageDesc: 'Automatique : celle d\'Obsidian. Recharge le plugin pour changer les commandes.',
  auto: 'Automatique', startup: 'Ouvrir Faceless au démarrage', startupDesc: 'Dans un onglet à part : tes onglets ouverts restent en place.',
  journal: 'Dossier du journal', journalDesc: 'Briefings « AAAA-MM-JJ - Briefing.md » et revues « AAAA-MM-JJ - Revue.md ».',
  projects: 'Dossier des projets', projectsDesc: 'Chaque sous-dossier est un projet. Vide : pas de panneau Projets.',
  reprise: 'Titre du point de reprise', repriseDesc: 'Expression régulière. Le premier titre correspondant dans le hub d\'un projet est affiché dans « Reprendre ».',
  instructions: 'Fichier d\'instructions (facultatif)', instructionsDesc: 'Son nombre de lignes est comparé au plafond écrit en tête (« Plafond : N lignes »).',
  shortcuts: 'Raccourcis', shortcutsDesc: 'Un nom de note par ligne, affiché en bas de l\'accueil.',
  reviewDay: 'Jour de la revue', deadlines: 'Échéances', deadlinesDesc: 'Une par ligne : « libellé | AAAA-MM » ou « libellé | AAAA-MM-JJ ».',
  thresholds: 'Seuils', sleep: 'Projet endormi après', sleepDesc: 'Jours sans aucune note modifiée dans le dossier du projet.',
  dead: 'Tâche à trancher après', deadDesc: 'Jours de dépassement de l\'échéance 📅.', resurface: 'Note à relire : non modifiée depuis', days: 'Jours.',
  taskEx: 'Dossiers ignorés pour les tâches', taskExDesc: 'Un par ligne. Leurs cases à cocher sont des checklists de référence.',
  resEx: 'Dossiers jamais proposés à la relecture', orphEx: 'Dossiers ignorés pour les notes sans lien', onePerLine: 'Un par ligne.',
  look: 'Apparence', theme: 'Thème Faceless dans tout Obsidian', themeDesc: 'Barre latérale, onglets, titres et barre d\'état aux couleurs de Faceless (thème sombre).',
  claudian: 'Claudian', skin: 'Habiller Claudian', skinDesc: 'Mêmes couleurs que Faceless. Claudian n\'est pas modifié : désactiver rend son style d\'origine.',
  autoSend: 'Envoyer la question automatiquement', prefix: 'Consigne ajoutée à chaque question', prefixDesc: 'Vide : consigne par défaut.',
  voice: 'Voix', engine: 'Voix utilisée', engineDesc: 'Voix du système, plus robotique. Une voix naturelle locale est possible avec un module séparé (accès disque et lancement d\'un programme), non inclus pour garder Faceless sans ces permissions.',
  natural: 'Naturelle si disponible', piperSys: 'Système', test: 'Écouter un essai',
  naturalOk: 'Module de voix naturelle détecté et prêt.', naturalNotReady: 'Module de voix naturelle détecté, mais pas encore configuré : voir ses réglages.',
  sysVoice: 'Voix du système (secours)', sysVoiceAuto: 'Automatique', rate: 'Vitesse de lecture',
  icons: 'Icônes', colorNames: 'Noms des dossiers principaux en couleur', manual: 'Icônes choisies à la main',
  manualDesc: (n: number) => `${n} icône(s). Clic droit sur un fichier → « Changer l'icône ».`, resetIcons: 'Tout remettre en automatique',
  reread: 'Notes marquées « Relue »', rereadDesc: (n: number) => `${n} note(s), exclues 90 jours.`, clear: 'Vider',
  weekdays: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
} : {
  home: 'Home', language: 'Language', languageDesc: 'Automatic: Obsidian\'s language. Reload the plugin to rename the commands.',
  auto: 'Automatic', startup: 'Open Faceless on startup', startupDesc: 'In its own tab: your open tabs stay where they are.',
  journal: 'Journal folder', journalDesc: 'Briefings "YYYY-MM-DD - Briefing.md" and reviews "YYYY-MM-DD - Review.md".',
  projects: 'Projects folder', projectsDesc: 'Each subfolder is a project. Empty: no Projects panel.',
  reprise: 'Checkpoint heading', repriseDesc: 'Regular expression. The first matching heading in a project hub is shown under "Pick up".',
  instructions: 'Instructions file (optional)', instructionsDesc: 'Its line count is compared with the cap written at the top ("Plafond : N lignes").',
  shortcuts: 'Shortcuts', shortcutsDesc: 'One note name per line, shown at the bottom of the home page.',
  reviewDay: 'Review day', deadlines: 'Deadlines', deadlinesDesc: 'One per line: "label | YYYY-MM" or "label | YYYY-MM-DD".',
  thresholds: 'Thresholds', sleep: 'Project idle after', sleepDesc: 'Days without any edited note in the project folder.',
  dead: 'Task to settle after', deadDesc: 'Days past the 📅 due date.', resurface: 'Note to revisit: not edited for', days: 'Days.',
  taskEx: 'Folders ignored for tasks', taskExDesc: 'One per line. Their checkboxes are reference checklists.',
  resEx: 'Folders never suggested for revisiting', orphEx: 'Folders ignored for orphan notes', onePerLine: 'One per line.',
  look: 'Appearance', theme: 'Faceless theme across Obsidian', themeDesc: 'Sidebar, tabs, headings and status bar in Faceless colors (dark theme).',
  claudian: 'Claudian', skin: 'Skin Claudian', skinDesc: 'Same colors as Faceless. Claudian itself is not modified: turning this off restores its style.',
  autoSend: 'Send the question automatically', prefix: 'Instruction added to each question', prefixDesc: 'Empty: default instruction.',
  voice: 'Voice', engine: 'Voice used', engineDesc: 'System voice, more robotic. A natural local voice is possible with a separate add-on (disk access and launching a program), not included so that Faceless needs neither.',
  natural: 'Natural when available', piperSys: 'System', test: 'Play a sample',
  naturalOk: 'Natural voice add-on detected and ready.', naturalNotReady: 'Natural voice add-on detected but not configured yet: see its settings.',
  sysVoice: 'System voice (fallback)', sysVoiceAuto: 'Automatic', rate: 'Reading speed',
  icons: 'Icons', colorNames: 'Color top-level folder names', manual: 'Hand-picked icons',
  manualDesc: (n: number) => `${n} icon(s). Right-click a file → "Change icon".`, resetIcons: 'Reset all to automatic',
  reread: 'Notes marked "Revisited"', rereadDesc: (n: number) => `${n} note(s), excluded for 90 days.`, clear: 'Clear',
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

class FacelessSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: FacelessPlugin) { super(app, plugin); }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const l = L();
    const save = () => this.plugin.saveSettings();
    const lines = (v: string) => v.split('\n').map(x => x.trim()).filter(Boolean);
    const area = (name: string, desc: string, get: () => string, set: (v: string) => void) =>
      new Setting(containerEl).setName(name).setDesc(desc).addTextArea(c => {
        c.setValue(get()).onChange(async v => { set(v); await save(); });
        c.inputEl.rows = 3;
      });
    const text = (name: string, desc: string, get: () => string, set: (v: string) => void) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText(c => c.setValue(get()).onChange(async v => { set(v.trim()); await save(); }));
    const num = (name: string, desc: string, get: () => number, set: (n: number) => void) =>
      new Setting(containerEl).setName(name).setDesc(desc).addText(c => c.setValue(String(get())).onChange(async v => {
        const n = Number(v); if (Number.isFinite(n) && n > 0) { set(n); await save(); }
      }));

    new Setting(containerEl).setName(l.home).setHeading();
    new Setting(containerEl).setName(l.language).setDesc(l.languageDesc).addDropdown(d => d
      .addOption('auto', l.auto).addOption('fr', 'Français').addOption('en', 'English').setValue(s.language)
      .onChange(async v => { s.language = v as FacelessSettings['language']; setLang(v === 'auto' ? obsidianLang() : v as Lang); await save(); this.display(); }));
    new Setting(containerEl).setName(l.startup).setDesc(l.startupDesc)
      .addToggle(c => c.setValue(s.openOnStartup).onChange(async v => { s.openOnStartup = v; await save(); }));
    text(l.journal, l.journalDesc, () => s.briefingFolder, v => { s.briefingFolder = v; });
    text(l.projects, l.projectsDesc, () => s.projectsFolder, v => { s.projectsFolder = v; });
    text(l.reprise, l.repriseDesc, () => s.repriseHeading, v => { s.repriseHeading = v || DEFAULTS.repriseHeading; });
    text(l.instructions, l.instructionsDesc, () => s.instructionsFile, v => { s.instructionsFile = v; });
    area(l.shortcuts, l.shortcutsDesc, () => s.shortcuts.join('\n'), v => { s.shortcuts = lines(v); });
    new Setting(containerEl).setName(l.reviewDay).addDropdown(d => {
      l.weekdays.forEach((n, i) => d.addOption(String(i + 1), n));
      d.setValue(String(s.reviewWeekday)).onChange(async v => { s.reviewWeekday = Number(v); await save(); });
    });
    area(l.deadlines, l.deadlinesDesc, () => s.deadlines.map(d => `${d.label} | ${d.date}`).join('\n'),
      v => { s.deadlines = lines(v).map(x => x.split('|').map(y => y.trim())).filter(p => p.length === 2 && p[0] && /^\d{4}-\d{2}(-\d{2})?$/.test(p[1])).map(p => ({ label: p[0], date: p[1] })); });

    new Setting(containerEl).setName(l.thresholds).setHeading();
    num(l.sleep, l.sleepDesc, () => s.sleepDays, n => { s.sleepDays = n; });
    num(l.dead, l.deadDesc, () => s.deadDays, n => { s.deadDays = n; });
    num(l.resurface, l.days, () => s.resurfaceMinDays, n => { s.resurfaceMinDays = n; });
    area(l.taskEx, l.taskExDesc, () => s.taskExcludeFolders.join('\n'), v => { s.taskExcludeFolders = lines(v); });
    area(l.resEx, l.onePerLine, () => s.resurfaceExcludeFolders.join('\n'), v => { s.resurfaceExcludeFolders = lines(v); });
    area(l.orphEx, l.onePerLine, () => s.orphanExcludeFolders.join('\n'), v => { s.orphanExcludeFolders = lines(v); });

    new Setting(containerEl).setName(l.look).setHeading();
    new Setting(containerEl).setName(l.theme).setDesc(l.themeDesc)
      .addToggle(c => c.setValue(s.themeAll).onChange(async v => { s.themeAll = v; await save(); this.plugin.applySkin(); }));

    if (this.plugin.hasClaudian()) {
      new Setting(containerEl).setName(l.claudian).setHeading();
      new Setting(containerEl).setName(l.skin).setDesc(l.skinDesc)
        .addToggle(c => c.setValue(s.skinClaudian).onChange(async v => { s.skinClaudian = v; await save(); this.plugin.applySkin(); }));
      new Setting(containerEl).setName(l.autoSend).addToggle(c => c.setValue(s.autoSend).onChange(async v => { s.autoSend = v; await save(); }));
      area(l.prefix, l.prefixDesc, () => s.askPrefix, v => { s.askPrefix = v; });
    }

    new Setting(containerEl).setName(l.voice).setHeading();
    const natural = this.plugin.naturalVoice();
    new Setting(containerEl).setName(l.engine).setDesc(natural ? (natural.ready() ? l.naturalOk : l.naturalNotReady) : l.engineDesc).addDropdown(d => d
      .addOption('natural', l.natural).addOption('system', l.piperSys).setValue(s.voiceEngine)
      .onChange(async v => { s.voiceEngine = v as FacelessSettings['voiceEngine']; await save(); }))
      .addButton(b => b.setButtonText(l.test).onClick(() => void this.plugin.speak(t().testPhrase)));
    const voices = window.speechSynthesis?.getVoices() ?? [];
    new Setting(containerEl).setName(l.sysVoice).addDropdown(d => {
      d.addOption('', l.sysVoiceAuto);
      for (const v of voices) d.addOption(v.name, `${v.name} (${v.lang})`);
      d.setValue(s.voiceName).onChange(async v => { s.voiceName = v; await save(); });
    });
    new Setting(containerEl).setName(l.rate)
      .addSlider(sl => sl.setLimits(0.7, 1.5, 0.05).setValue(s.speechRate).onChange(async v => { s.speechRate = v; await save(); }));

    new Setting(containerEl).setName(l.icons).setHeading();
    new Setting(containerEl).setName(l.colorNames)
      .addToggle(c => c.setValue(s.colorFolderNames).onChange(async v => { s.colorFolderNames = v; await save(); this.plugin.icons.applyAll(); }));
    new Setting(containerEl).setName(l.manual).setDesc(l.manualDesc(Object.keys(s.iconOverrides).length))
      .addButton(b => b.setButtonText(l.resetIcons).onClick(async () => { s.iconOverrides = {}; await save(); this.plugin.icons.applyAll(); this.display(); }));
    new Setting(containerEl).setName(l.reread).setDesc(l.rereadDesc(Object.keys(s.resurfaced).length))
      .addButton(b => b.setButtonText(l.clear).onClick(async () => { s.resurfaced = {}; await save(); this.display(); }));
  }
}
