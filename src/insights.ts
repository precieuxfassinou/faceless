import { App, TFile, TFolder, moment as obsidianMoment } from 'obsidian';
import type { Moment } from 'moment';
import type { FacelessSettings } from './main';
import { lang, t } from './i18n';

// Le moment fourni par Obsidian est appelable ; ses types ne le disent pas avec cette configuration TypeScript.
export const moment = obsidianMoment as unknown as typeof import('moment');
export type { Moment };

const DAY = 86_400_000;

export interface Task { file: TFile; line: number; raw: string; text: string; due?: string }
export interface Reprise { date: string | null; text: string; file: TFile; line: number }
export interface Project {
  name: string; folder: TFolder; files: TFile[]; hub?: TFile; last: number; sleeping: boolean;
  roadmap?: { done: number; total: number; file: TFile }; reprise?: Reprise;
}
export interface Deadline { label: string; date: string; when: Moment; precise: boolean }
export interface Health {
  notes: number; orphans: TFile[]; unresolved: { source: string; target: string }[];
  indexLines?: number; indexCap?: number; lastChangelog?: string;
}
export interface Snapshot {
  now: Moment; projects: Project[]; tasks: Task[]; deadTasks: Task[]; deadlines: Deadline[];
  forgotten: TFile | null; forgottenExcerpt: string; briefing: TFile | null; health: Health;
  review: TFile | null; isReviewDay: boolean;
}

/* ------------------------------------------------------------------ texte */

export function plain(md: string): string {
  return md
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, t: string) => t.split('#')[0])
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[,;:.\s]+$/, '') + '…';
}

/** « depuis 18 jours », « depuis juillet » / "for 18 days", "since July" */
export function sinceWords(ts: number, now: Moment): string {
  const fr = lang() === 'fr';
  const days = Math.floor((now.valueOf() - ts) / DAY);
  if (days < 45) return fr ? `depuis ${days} jours` : `for ${days} days`;
  const m = moment(ts).locale(lang());
  const when = m.year() === now.year() ? m.format('MMMM') : m.format('MMMM YYYY');
  return fr ? `depuis ${when}` : `since ${when}`;
}

export function ago(ts: number, now: Moment): string {
  const fr = lang() === 'fr';
  const days = Math.floor((now.clone().startOf('day').valueOf() - moment(ts).startOf('day').valueOf()) / DAY);
  if (days <= 0) return fr ? 'aujourd’hui' : 'today';
  if (days === 1) return fr ? 'hier' : 'yesterday';
  if (days < 60) return fr ? `il y a ${days} j` : `${days} d ago`;
  return moment(ts).locale(lang()).format('MMM YYYY');
}

/* ------------------------------------------------------------------ hasard reproductible (une note par jour) */

function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------------------------------------------ collecte */

export class Insights {
  constructor(private app: App, private s: FacelessSettings) {}

  private inFolder(f: TFile, folders: string[]) {
    return folders.some(x => { const p = x.replace(/\/+$/, ''); return p && (f.path === p || f.path.startsWith(p + '/')); });
  }

  async snapshot(reroll = 0): Promise<Snapshot> {
    const now = moment();
    const tasks = await this.tasks();
    const projects = await this.projects();
    const today = now.format('YYYY-MM-DD');
    const deadLimit = now.clone().subtract(this.s.deadDays, 'days').format('YYYY-MM-DD');
    const kept = this.s.keptTasks;
    const deadTasks = tasks
      .filter(t => t.due && t.due < deadLimit)
      .filter(t => { const k = kept[taskKey(t)]; return !k || k < now.clone().subtract(30, 'days').format('YYYY-MM-DD'); })
      .sort((a, b) => a.due!.localeCompare(b.due!));
    const { file: forgotten, excerpt } = await this.forgotten(projects, now, reroll);
    return {
      now, projects, tasks, deadTasks, deadlines: this.deadlines(now), forgotten, forgottenExcerpt: excerpt,
      briefing: this.dated(t().briefingFile, today), review: this.dated(t().reviewFile, today, 6),
      isReviewDay: now.isoWeekday() === this.s.reviewWeekday, health: await this.health(),
    };
  }

  /* ---------- tâches */

  async tasks(): Promise<Task[]> {
    const out: Task[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.inFolder(f, this.s.taskExcludeFolders)) continue;
      const items = this.app.metadataCache.getFileCache(f)?.listItems?.filter(li => li.task === ' ');
      if (!items?.length) continue;
      const lines = (await this.app.vault.cachedRead(f)).split('\n');
      for (const li of items) {
        const raw = lines[li.position.start.line] ?? '';
        const due = raw.match(/📅\s*(\d{4}-\d{2}-\d{2})/u)?.[1];
        const text = raw
          .replace(/^\s*[-*+]\s*\[ \]\s*/, '')
          .replace(/(📅|⏳|🛫|➕|✅|❌)\s*\d{4}-\d{2}-\d{2}/gu, '')
          .replace(/[⏫🔼🔽⏬🔺🔁]/gu, '')
          .trim();
        if (text) out.push({ file: f, line: li.position.start.line, raw, text: plain(text), due });
      }
    }
    return out;
  }

  /* ---------- projets */

  async projects(): Promise<Project[]> {
    if (!this.s.projectsFolder.trim()) return [];
    const root = this.app.vault.getAbstractFileByPath(this.s.projectsFolder);
    if (!(root instanceof TFolder) || root.isRoot()) return [];
    const now = Date.now();
    const out: Project[] = [];
    for (const folder of root.children) {
      if (!(folder instanceof TFolder)) continue;
      const files: TFile[] = [];
      const walk = (d: TFolder) => { for (const c of d.children) { if (c instanceof TFile && c.extension === 'md') files.push(c); else if (c instanceof TFolder) walk(c); } };
      walk(folder);
      if (!files.length) continue;
      const last = Math.max(...files.map(f => f.stat.mtime));
      const hub = files.find(f => /hub/i.test(f.basename)) ?? files.find(f => f.basename === folder.name);
      const roadmapFile = files.find(f => /roadmap/i.test(f.basename));
      let roadmap: Project['roadmap'];
      if (roadmapFile) {
        const items = this.app.metadataCache.getFileCache(roadmapFile)?.listItems?.filter(li => li.task !== undefined) ?? [];
        if (items.length) roadmap = { done: items.filter(li => li.task !== ' ').length, total: items.length, file: roadmapFile };
      }
      out.push({
        name: folder.name, folder, files, hub, last, roadmap,
        sleeping: now - last > this.s.sleepDays * DAY,
        reprise: hub ? await this.reprise(hub) : undefined,
      });
    }
    return out.sort((a, b) => b.last - a.last);
  }

  /** Premier titre « Point de reprise » du hub : sa date et son texte. */
  private async reprise(hub: TFile): Promise<Reprise | undefined> {
    const heads = this.app.metadataCache.getFileCache(hub)?.headings ?? [];
    let re: RegExp;
    try { re = new RegExp(this.s.repriseHeading, 'i'); } catch { re = /point de reprise|checkpoint/i; }
    const i = heads.findIndex(h => re.test(h.heading));
    if (i < 0) return undefined;
    const h = heads[i];
    const lines = (await this.app.vault.cachedRead(hub)).split('\n');
    const end = heads[i + 1]?.position.start.line ?? lines.length;
    const body = lines.slice(h.position.start.line + 1, end).join('\n');
    const first = body.split(/\n\s*\n/).map(p => plain(p)).find(p => p.length > 40) ?? plain(body);
    return { date: h.heading.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, text: first, file: hub, line: h.position.start.line };
  }

  /* ---------- note à relire : liée aux projets actifs de préférence */

  private async forgotten(projects: Project[], now: Moment, reroll: number): Promise<{ file: TFile | null; excerpt: string }> {
    const minAge = this.s.resurfaceMinDays * DAY;
    const seen = this.s.resurfaced;
    const seenLimit = now.clone().subtract(90, 'days').format('YYYY-MM-DD');
    const active = projects.filter(p => !p.sleeping);
    const activePaths = new Set(active.flatMap(p => p.files.map(f => f.path)));
    const activeNames = active.map(p => p.name.toLowerCase());
    const links = this.app.metadataCache.resolvedLinks;
    const linkedToActive = new Set<string>();
    for (const src of activePaths) for (const dst of Object.keys(links[src] ?? {})) linkedToActive.add(dst);
    for (const [src, dsts] of Object.entries(links)) if (Object.keys(dsts).some(d => activePaths.has(d))) linkedToActive.add(src);
    const sleepingPaths = new Set(projects.filter(p => p.sleeping).flatMap(p => p.files.map(f => f.path)));

    const pool: { f: TFile; w: number }[] = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (this.inFolder(f, this.s.resurfaceExcludeFolders)) continue;
      if (f.stat.size < 400 || /hub|index|dashboard/i.test(f.basename)) continue;
      if (now.valueOf() - f.stat.mtime < minAge) continue;
      if (seen[f.path] && seen[f.path] > seenLimit) continue;
      let w = 1;
      if (activePaths.has(f.path) || linkedToActive.has(f.path) || activeNames.some(n => f.basename.toLowerCase().includes(n))) w = 4;
      else if (sleepingPaths.has(f.path)) w = 0.5;
      pool.push({ f, w });
    }
    if (!pool.length) return { file: null, excerpt: '' };
    pool.sort((a, b) => a.f.path.localeCompare(b.f.path));
    const rnd = seeded(`${now.format('YYYY-MM-DD')}#${reroll}`);
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = rnd() * total;
    let file = pool[pool.length - 1].f;
    for (const p of pool) { r -= p.w; if (r <= 0) { file = p.f; break; } }
    const raw = (await this.app.vault.cachedRead(file)).replace(/^---[\s\S]*?\n---\n?/, '');
    const para = raw.split(/\n\s*\n/).filter(p => !/^\s*(#|\||```|- \[|!\[)/.test(p)).map(plain).find(p => p.length > 60) ?? '';
    return { file, excerpt: clip(para, 340) };
  }

  /* ---------- échéances */

  private deadlines(now: Moment): Deadline[] {
    return this.s.deadlines
      .map(d => {
        const precise = /^\d{4}-\d{2}-\d{2}$/.test(d.date);
        const when = precise ? moment(d.date, 'YYYY-MM-DD') : moment(d.date, 'YYYY-MM');
        return { ...d, when, precise };
      })
      .filter(d => d.when.isValid() && d.when.clone().endOf(d.precise ? 'day' : 'month').isAfter(now))
      .sort((a, b) => a.when.valueOf() - b.when.valueOf());
  }

  /* ---------- notes datées du journal (briefing, revue) */

  private dated(kind: string, today: string, maxAgeDays = 0): TFile | null {
    const folder = this.s.briefingFolder.replace(/\/+$/, '');
    const exact = this.app.vault.getAbstractFileByPath(`${folder}/${today} - ${kind}.md`);
    if (exact instanceof TFile) return exact;
    if (!maxAgeDays) return null;
    const limit = moment().subtract(maxAgeDays, 'days').format('YYYY-MM-DD');
    const re = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}) - ${kind}$`);
    const recent = this.app.vault.getMarkdownFiles()
      .filter(f => f.parent?.path === folder && re.test(f.basename) && f.basename.slice(0, 10) >= limit)
      .sort((a, b) => b.basename.localeCompare(a.basename));
    return recent[0] ?? null;
  }

  /* ---------- santé du vault */

  private async health(): Promise<Health> {
    const files = this.app.vault.getMarkdownFiles();
    const inbound = new Set<string>();
    for (const dsts of Object.values(this.app.metadataCache.resolvedLinks)) for (const d of Object.keys(dsts)) inbound.add(d);
    const orphans = files.filter(f => !inbound.has(f.path) && !this.inFolder(f, this.s.orphanExcludeFolders));
    const unresolved: Health['unresolved'] = [];
    for (const [source, dsts] of Object.entries(this.app.metadataCache.unresolvedLinks)) {
      if (source === 'Templates' || source.startsWith('Templates/')) continue;
      for (const target of Object.keys(dsts)) unresolved.push({ source, target });
    }
    const h: Health = { notes: files.length, orphans, unresolved };
    const index = this.s.instructionsFile.trim() ? this.app.vault.getAbstractFileByPath(this.s.instructionsFile) : null;
    if (index instanceof TFile) {
      const text = await this.app.vault.cachedRead(index);
      h.indexLines = text.replace(/\n$/, '').split('\n').length;
      h.indexCap = Number(text.match(/Plafond\s*:\s*(\d+)/i)?.[1]) || undefined;
      const log = text.split(/^##\s+Changelog/im)[1] ?? '';
      const dates = [...log.matchAll(/^-\s*(\d{4}-\d{2}-\d{2})/gm)].map(m => m[1]).sort();
      h.lastChangelog = dates[dates.length - 1];
    }
    return h;
  }
}

export const taskKey = (t: Task) => `${t.file.path}::${t.text}`;
