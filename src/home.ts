import { App, FuzzySuggestModal, ItemView, MarkdownRenderer, TFile, WorkspaceLeaf, debounce, setIcon } from 'obsidian';
import { Insights, ago, clip, moment, plain, taskKey, type Snapshot, type Task } from './insights';
import { compose, dayWords, untilWords, weekdayName } from './voice';
import { buildGauge, buildReactor, type Reactor } from './reactor';
import { lang, t } from './i18n';
import type FacelessPlugin from './main';

export const HOME_VIEW = 'faceless-home';


const DAY = 86_400_000;

export class HomeView extends ItemView {
  private reroll = 0;
  private rendering = false;
  private firstPaint = true;
  private reactor: Reactor | null = null;
  private clockEl!: HTMLElement;
  private dateEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private raf = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: FacelessPlugin) { super(leaf); }

  getViewType() { return HOME_VIEW; }
  getDisplayText() { return 'Faceless'; }
  getIcon() { return 'ph-waveform'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('fl-hud');
    const top = root.createDiv({ cls: 'fl-top' });
    const brand = top.createDiv({ cls: 'fl-brand' });
    brand.createSpan({ cls: 'fl-brand-name', text: 'Faceless' });
    brand.createSpan({ cls: 'fl-brand-sub', text: t().sub });
    const time = top.createDiv({ cls: 'fl-time' });
    this.clockEl = time.createDiv({ cls: 'fl-clock' });
    this.dateEl = time.createDiv({ cls: 'fl-date' });
    this.bodyEl = root.createDiv({ cls: 'fl-body' });

    this.tick();
    this.registerInterval(window.setInterval(() => this.tick(), 15_000));
    this.registerDomEvent(root, 'mousemove', (e) => this.parallax(e));
    this.registerDomEvent(root, 'mouseleave', () => { root.style.setProperty('--px', '0'); root.style.setProperty('--py', '0'); });
    await this.render();

    const soon = debounce(() => { if (this.contentEl.isShown()) void this.render(); }, 2500, true);
    this.registerEvent(this.app.vault.on('modify', soon));
    this.registerEvent(this.app.vault.on('create', soon));
    this.registerEvent(this.app.vault.on('delete', soon));
    this.registerEvent(this.app.vault.on('rename', soon));
    this.registerEvent(this.app.metadataCache.on('resolved', soon));
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => { if (leaf === this.leaf) void this.render(); }));
  }

  async onClose() {
    this.plugin.stopSpeaking();
    cancelAnimationFrame(this.raf);
    this.contentEl.empty();
  }

  private tick() {
    const now = moment().locale(lang());
    this.clockEl?.setText(now.format('HH:mm'));
    this.dateEl?.setText(lang() === 'fr' ? `${now.format('dddd D MMMM')} · S${now.isoWeek()}` : `${now.format('dddd, MMMM D')} · W${now.isoWeek()}`);
  }

  /** Profondeur : le réacteur et les panneaux glissent de quelques pixels, en sens opposés. */
  private parallax(e: MouseEvent) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      const r = this.contentEl.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      this.contentEl.style.setProperty('--px', x.toFixed(3));
      this.contentEl.style.setProperty('--py', y.toFixed(3));
    });
  }

  /* ================================================================ rendu */

  async render() {
    if (this.rendering) return;
    this.rendering = true;
    try {
      const s = await new Insights(this.app, this.plugin.settings).snapshot(this.reroll);
      const body = this.bodyEl;
      body.empty();
      body.toggleClass('fl-enter', this.firstPaint);
      this.firstPaint = false;
      let i = 0;
      const stagger = (e: HTMLElement) => { e.style.setProperty('--i', String(i++)); return e; };

      this.renderTape(stagger(body.createDiv({ cls: 'fl-tape' })), s);
      const hero = stagger(body.createDiv({ cls: 'fl-hero' }));
      this.renderCore(hero.createDiv({ cls: 'fl-core' }), s);
      this.renderVoice(hero.createDiv({ cls: 'fl-voice-wrap' }), s);

      const grid = body.createDiv({ cls: 'fl-grid' });
      const panel = (code: string, title: string, span: string, meta?: string) => {
        const p = stagger(grid.createDiv({ cls: `fl-panel ${span}` }));
        const h = p.createDiv({ cls: 'fl-panel-head' });
        h.createSpan({ cls: 'fl-code', text: code });
        h.createSpan({ cls: 'fl-panel-title', text: title });
        h.createSpan({ cls: 'fl-rule' });
        if (meta) h.createSpan({ cls: 'fl-panel-meta', text: meta });
        return p.createDiv({ cls: 'fl-panel-body' });
      };

      const withReprise = s.projects.filter(p => p.reprise);
      if (withReprise.length) this.renderReprise(panel('R-01', t().pReprise, 'fl-span-7'), s);
      if (s.projects.length) this.renderProjects(panel('P-02', t().pProjects, withReprise.length ? 'fl-span-5' : 'fl-span-12',
        t().asleep(s.projects.filter(p => p.sleeping).length)), s);
      if (s.briefing) await this.renderBriefing(panel('B-03', t().pBriefing, 'fl-span-12', t().thisMorning), s);
      if (s.forgotten) this.renderForgotten(panel('N-04', t().pForgotten, 'fl-span-4', t().modified(ago(s.forgotten.stat.mtime, s.now))), s);
      if (s.deadTasks.length) this.renderDeadTasks(panel('T-05', t().pDead, 'fl-span-4 is-alert', `${s.deadTasks.length}`), s);
      this.renderStatus(panel('S-06', t().pStatus, 'fl-span-4'), s);
      const review = s.isReviewDay || !!s.review;
      if (review) this.renderReview(panel('V-07', t().pReview, 'fl-span-4', s.review ? dayWords(s.review.basename.slice(0, 10), s.now) : weekdayName(this.plugin.settings.reviewWeekday)), s);
      if (this.plugin.hasClaudian()) this.renderAsk(panel('Q-08', t().pAsk, review ? 'fl-span-8' : 'fl-span-12', t().viaClaudian));
      this.renderGoTo(stagger(body.createDiv({ cls: 'fl-goto' })));
    } finally {
      this.rendering = false;
    }
  }

  /* ---------- bande de cap : 3 semaines, aujourd'hui au centre */

  private renderTape(tape: HTMLElement, s: Snapshot) {
    const today = s.now.clone().startOf('day');
    const marks = new Map<string, string[]>();
    const add = (d: string, label: string) => marks.set(d, [...(marks.get(d) ?? []), label]);
    for (const t of s.tasks) if (t.due) add(t.due, t.text);
    for (const d of s.deadlines) if (d.precise) add(d.when.format('YYYY-MM-DD'), d.label);
    const row = tape.createDiv({ cls: 'fl-tape-row' });
    for (let k = -10; k <= 10; k++) {
      const d = today.clone().add(k, 'days');
      const cell = row.createDiv({ cls: 'fl-tape-day' + (k === 0 ? ' is-today' : '') + (d.isoWeekday() >= 6 ? ' is-weekend' : '') });
      cell.createDiv({ cls: 'fl-tape-tick' });
      cell.createDiv({ cls: 'fl-tape-label', text: k === 0 ? d.locale(lang()).format('ddd D') : d.format('D') });
      const m = marks.get(d.format('YYYY-MM-DD'));
      if (m) { cell.addClass('has-mark'); cell.setAttr('aria-label', m.join('\n')); }
    }
    const next = s.deadlines[0];
    if (next) {
      const t = tape.createDiv({ cls: 'fl-tape-next' });
      t.createSpan({ cls: 'fl-tape-next-label', text: next.label });
      t.createSpan({ cls: 'fl-tape-next-value', text: this.tMinus(next.when, next.precise, s.now) });
    }
  }

  private tMinus(when: any, precise: boolean, now: any): string {
    const days = Math.ceil((when.valueOf() - now.clone().startOf('day').valueOf()) / DAY);
    if (precise && days <= 60) return `T-${Math.max(days, 0)} ${lang() === 'fr' ? 'j' : 'd'}`;
    const months = when.clone().startOf('month').diff(now.clone().startOf('month'), 'months');
    return `T-${Math.max(months, 0)} ${lang() === 'fr' ? 'mois' : 'mo'}`;
  }

  /* ---------- le noyau */

  private renderCore(parent: HTMLElement, s: Snapshot) {
    let done = 0, total = 0;
    for (const p of s.projects) if (p.roadmap) { done += p.roadmap.done; total += p.roadmap.total; }
    this.reactor = buildReactor(parent, {
      segments: s.projects.map(p => ({ name: p.name, sleeping: p.sleeping })),
      progress: total ? done / total : 0,
      caption: t().roadmaps(total ? `${Math.round(done / total * 100)} %` : '—'),
    });
    const legend = parent.createDiv({ cls: 'fl-core-legend' });
    legend.createSpan({ text: t().active(s.projects.filter(p => !p.sleeping).length, s.projects.filter(p => p.sleeping).length) });
    legend.createSpan({ text: t().steps(done, total) });
  }

  /* ---------- la voix */

  private renderVoice(parent: HTMLElement, s: Snapshot) {
    const sentences = compose(s, this.plugin.settings);
    const p = parent.createEl('p', { cls: 'fl-voice' });
    sentences.forEach((t, i) => { p.createSpan({ text: t, cls: i === 0 ? 'fl-voice-date' : '' }); p.appendText(' '); });
    const actions = parent.createDiv({ cls: 'fl-actions' });
    const listen = this.button(actions, 'ph-speaker-high', s.briefing ? t().listenAll : t().listen, async () => {
      if (this.plugin.speaking) { this.plugin.stopSpeaking(); return; }
      let text = sentences.join(' ');
      if (s.briefing) text += '\n\n' + plain(await this.app.vault.cachedRead(s.briefing));
      listen.addClass('is-on');
      this.contentEl.addClass('is-speaking');
      void this.plugin.speak(text,
        () => { listen.removeClass('is-on'); this.contentEl.removeClass('is-speaking'); this.reactor?.rest(); },
        (levels) => levels ? this.reactor?.level(levels) : this.reactor?.pulse());
    });
    listen.addClass('is-primary');
    if (s.briefing) this.button(actions, 'ph-sun-horizon', t().openBriefing, () => this.openNote(s.briefing!));
    this.button(actions, 'ph-arrow-clockwise', t().refresh, () => void this.render());
  }

  /* ---------- panneaux */

  private renderReprise(body: HTMLElement, s: Snapshot) {
    const list = s.projects.filter(p => p.reprise).sort((a, b) => (b.reprise!.date ?? '').localeCompare(a.reprise!.date ?? ''));
    for (const p of list) {
      const item = body.createDiv({ cls: 'fl-reprise' });
      const head = item.createDiv({ cls: 'fl-line' });
      head.createSpan({ cls: 'fl-strong', text: p.name });
      if (p.reprise!.date) head.createSpan({ cls: 'fl-mono fl-dim', text: dayWords(p.reprise!.date, s.now) });
      item.createEl('p', { cls: 'fl-text', text: clip(p.reprise!.text, 520) });
      this.button(item.createDiv({ cls: 'fl-actions' }), 'ph-arrow-square-out', t().openReprise, () => this.openNote(p.reprise!.file, p.reprise!.line));
    }
  }

  private renderProjects(body: HTMLElement, s: Snapshot) {
    const wrap = body.createDiv({ cls: 'fl-gauges' });
    for (const p of s.projects) {
      const g = wrap.createDiv({ cls: 'fl-gauge-item' + (p.sleeping ? ' is-sleeping' : '') });
      buildGauge(g, p.roadmap ? p.roadmap.done / p.roadmap.total : null, p.sleeping);
      g.createDiv({ cls: 'fl-gauge-name', text: p.name });
      g.createDiv({ cls: 'fl-gauge-state', text: p.sleeping ? `${t().asleepShort} · ${moment(p.last).locale(lang()).format('MMM')}` : ago(p.last, s.now) });
      g.setAttr('aria-label', p.roadmap ? `${t().roadmap} : ${p.roadmap.done}/${p.roadmap.total}` : t().noRoadmap);
      const target = p.hub ?? p.roadmap?.file ?? p.files[0];
      if (target) g.addEventListener('click', () => this.openNote(target));
    }
  }

  private async renderBriefing(body: HTMLElement, s: Snapshot) {
    const md = (await this.app.vault.cachedRead(s.briefing!)).replace(/^---[\s\S]*?\n---\n?/, '');
    await MarkdownRenderer.render(this.app, md, body.createDiv({ cls: 'fl-briefing markdown-rendered' }), s.briefing!.path, this);
  }

  private renderForgotten(body: HTMLElement, s: Snapshot) {
    const f = s.forgotten!;
    const title = body.createDiv({ cls: 'fl-strong fl-link', text: f.basename });
    title.addEventListener('click', () => this.openNote(f));
    body.createDiv({ cls: 'fl-mono fl-dim', text: f.parent?.path ?? '' });
    if (s.forgottenExcerpt) body.createEl('p', { cls: 'fl-text', text: clip(s.forgottenExcerpt, 260) });
    const a = body.createDiv({ cls: 'fl-actions' });
    this.button(a, 'ph-arrow-square-out', t().open, () => this.openNote(f));
    this.button(a, 'ph-check', t().reread, async () => {
      this.plugin.settings.resurfaced[f.path] = s.now.format('YYYY-MM-DD');
      await this.plugin.saveSettings();
      void this.render();
    });
    this.button(a, 'ph-shuffle', t().another, () => { this.reroll++; void this.render(); });
  }

  private renderDeadTasks(body: HTMLElement, s: Snapshot) {
    body.createDiv({ cls: 'fl-note', text: t().overdueBy(this.plugin.settings.deadDays) });
    const tr = t();
    for (const task of s.deadTasks.slice(0, 5)) {
      const row = body.createDiv({ cls: 'fl-task' });
      const line = row.createDiv({ cls: 'fl-line' });
      const txt = line.createSpan({ cls: 'fl-link', text: clip(task.text, 70) });
      txt.addEventListener('click', () => this.openNote(task.file, task.line));
      line.createSpan({ cls: 'fl-mono fl-alert', text: moment(task.due).locale(lang()).format(lang() === 'fr' ? 'D MMM' : 'MMM D') });
      const a = row.createDiv({ cls: 'fl-actions fl-actions-small' });
      this.button(a, 'ph-x', tr.abandon, () => void this.plugin.abandonTask(task));
      this.button(a, 'ph-clock', tr.keep, () => void this.keepTask(task));
    }
    if (s.deadTasks.length > 5) body.createDiv({ cls: 'fl-note', text: t().andMore(s.deadTasks.length - 5) });
  }

  private async keepTask(task: Task) {
    this.plugin.settings.keptTasks[taskKey(task)] = moment().format('YYYY-MM-DD');
    await this.plugin.saveSettings();
    void this.render();
  }

  private renderStatus(body: HTMLElement, s: Snapshot) {
    const h = s.health;
    const row = (label: string, value: string, warn = false, onClick?: () => void, ratio?: number) => {
      const r = body.createDiv({ cls: 'fl-stat' + (warn ? ' is-warn' : '') + (onClick ? ' is-link' : '') });
      const l = r.createDiv({ cls: 'fl-line' });
      l.createSpan({ cls: 'fl-stat-label', text: label });
      l.createSpan({ cls: 'fl-mono', text: value });
      if (ratio !== undefined) r.createDiv({ cls: 'fl-bar' }).createDiv({ cls: 'fl-bar-fill' }).style.width = `${Math.min(100, ratio * 100).toFixed(0)}%`;
      if (onClick) r.addEventListener('click', onClick);
    };
    row(t().sNotes, String(h.notes));
    row(t().sOrphans, String(h.orphans.length), h.orphans.length > 20,
      h.orphans.length ? () => new FileListModal(this.app, h.orphans.map(f => ({ label: f.path, file: f })), t().orphansTitle).open() : undefined);
    row(t().sUnresolved, String(h.unresolved.length), false,
      h.unresolved.length ? () => new FileListModal(this.app, h.unresolved.map(u => ({ label: `${u.target}  ←  ${u.source}`, file: this.app.vault.getAbstractFileByPath(u.source) as TFile })), t().unresolvedTitle).open() : undefined);
    if (h.indexLines) {
      const ratio = h.indexCap ? h.indexLines / h.indexCap : undefined;
      row(t().sIndex, h.indexCap ? `${h.indexLines}/${h.indexCap}` : `${h.indexLines}`, !!ratio && ratio > 0.9,
        () => { const f = this.app.vault.getAbstractFileByPath(this.plugin.settings.instructionsFile); if (f instanceof TFile) this.openNote(f); }, ratio);
    }
    if (h.lastChangelog) row(t().sChangelog, moment(h.lastChangelog).locale(lang()).format(lang() === 'fr' ? 'D MMM' : 'MMM D'));
    for (const d of s.deadlines) row(d.label, untilWords(d, s.now).replace(/^(dans environ|in about) /, '≈ '));
  }

  private renderReview(body: HTMLElement, s: Snapshot) {
    body.createEl('p', { cls: 'fl-text', text: t().reviewText });
    this.button(body.createDiv({ cls: 'fl-actions' }), 'ph-list-checks', s.review ? t().openReview : t().startReview, () => void this.plugin.openReview()).addClass('is-primary');
  }

  private renderAsk(body: HTMLElement) {
    const line = body.createDiv({ cls: 'fl-prompt' });
    line.createSpan({ cls: 'fl-prompt-caret', text: '>' });
    const input = line.createEl('input', { cls: 'fl-prompt-input', attr: { type: 'text', placeholder: t().askPlaceholder, spellcheck: 'false' } });
    const send = (q: string) => { if (q.trim()) void this.plugin.askClaudian(q.trim()); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(input.value); input.value = ''; } });
    const chips = body.createDiv({ cls: 'fl-suggest' });
    for (const q of t().questions) chips.createSpan({ cls: 'fl-suggest-item', text: q }).addEventListener('click', () => send(q));
  }

  private renderGoTo(parent: HTMLElement) {
    const cmd = (id: string) => (this.app as any).commands?.executeCommandById(id);
    const enabled = (id: string) => !!(this.app as any).plugins?.enabledPlugins?.has(id);
    if (enabled('galaxie-3d')) this.button(parent, 'ph-planet', t().galaxy, () => cmd('galaxie-3d:open'));
    if (this.plugin.hasClaudian()) this.button(parent, 'ph-chat-text', t().claudian, () => void this.plugin.revealClaudian());
    this.button(parent, 'ph-magnifying-glass', t().search, () => cmd(enabled('omnisearch') ? 'omnisearch:show-modal' : 'global-search:open'));
    for (const name of this.plugin.settings.shortcuts) {
      const f = this.app.metadataCache.getFirstLinkpathDest(name, '');
      if (f) this.button(parent, 'ph-arrow-square-out', f.basename, () => this.openNote(f));
    }
    if (!parent.childElementCount) parent.remove();
  }

  /* ================================================================ outils */

  private openNote(file: TFile, line?: number) {
    void this.app.workspace.getLeaf('tab').openFile(file, line !== undefined ? { eState: { line } } : undefined);
  }

  private button(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
    const b = parent.createEl('button', { cls: 'fl-btn' });
    setIcon(b.createSpan({ cls: 'fl-btn-icon' }), icon);
    b.createSpan({ text: label });
    b.addEventListener('click', onClick);
    return b;
  }
}

class FileListModal extends FuzzySuggestModal<{ label: string; file: TFile }> {
  constructor(app: App, private items: { label: string; file: TFile }[], placeholder: string) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems() { return this.items.filter(i => i.file); }
  getItemText(i: { label: string }) { return i.label; }
  onChooseItem(i: { file: TFile }) { void this.app.workspace.getLeaf('tab').openFile(i.file); }
}
