/*
 * Voix naturelle : Piper (moteur neuronal libre, local), installé par l'utilisateur.
 * Faceless ne télécharge rien : il lance le programme et la voix dont on lui donne les chemins.
 */
import { Platform } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export const PIPER_RELEASES = 'https://github.com/rhasspy/piper/releases/tag/2023.11.14-2';
export const PIPER_VOICES_URL = 'https://huggingface.co/rhasspy/piper-voices/tree/main';

/** Dossier proposé par défaut, hors du vault. */
export function defaultDir(): string {
  const root = process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share');
  return path.join(root, 'Faceless', 'piper');
}

/** Cherche piper(.exe) et un modèle .onnx dans le dossier par défaut. */
export function detect(): { exe: string; model: string } {
  const dir = defaultDir();
  const name = Platform.isWin ? 'piper.exe' : 'piper';
  const exe = [path.join(dir, 'piper', name), path.join(dir, name)].find(p => fs.existsSync(p)) ?? '';
  let model = '';
  for (const d of [path.join(dir, 'voices'), dir]) {
    try {
      const f = fs.readdirSync(d).find(x => x.endsWith('.onnx') && fs.existsSync(path.join(d, x + '.json')));
      if (f) { model = path.join(d, f); break; }
    } catch { /* dossier absent */ }
  }
  return { exe, model };
}

export function ready(exe: string, model: string): boolean {
  return !!exe && !!model && fs.existsSync(exe) && fs.existsSync(model) && fs.existsSync(model + '.json');
}

/** Rend le texte plus naturel à l'oral. */
export function speakable(text: string): string {
  return text
    .replace(/(\d{1,2}) h (\d{2})/g, (_, h: string, m: string) => `${Number(h)} heure${Number(h) > 1 ? 's' : ''} ${m === '00' ? '' : Number(m)}`)
    .replace(/ ; /g, ', ')
    .replace(/[«»"]/g, '')
    .replace(/\s*\n+\s*/g, '\n')
    .trim();
}

/**
 * Lecture en flux : Piper écrit du PCM 16 bits sur sa sortie, on le joue au fil de l'eau
 * avec Web Audio, et l'analyseur donne le niveau réel de la voix pour animer l'onde.
 */
export class PiperPlayer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private nextTime = 0;
  private procDone = false;
  private raf = 0;
  private done: (() => void) | null = null;

  get speaking() { return !!this.done; }

  speak(text: string, exe: string, model: string, rate: number, onLevel: (levels: number[]) => void, onEnd: () => void) {
    this.stop();
    const cfg = JSON.parse(fs.readFileSync(model + '.json', 'utf8'));
    const sampleRate: number = cfg?.audio?.sample_rate ?? 22050;
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.55;
    analyser.connect(ctx.destination);
    this.ctx = ctx; this.analyser = analyser; this.nextTime = 0; this.procDone = false;
    this.done = onEnd;

    const proc = spawn(exe, ['--model', model, '--output_raw', '--length_scale', (1 / rate).toFixed(2), '--sentence_silence', '0.3'],
      { cwd: path.dirname(exe), windowsHide: true });
    this.proc = proc;
    let rest: Buffer | null = null;
    proc.stdout.on('data', (chunk: Buffer) => {
      const buf = rest ? Buffer.concat([rest, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      rest = usable < buf.length ? buf.subarray(usable) : null;
      if (usable) this.enqueue(buf.subarray(0, usable), sampleRate);
    });
    proc.on('close', () => { this.procDone = true; this.maybeEnd(); });
    proc.on('error', () => this.finish());
    proc.stdin.write(speakable(text) + '\n');
    proc.stdin.end();

    const bins = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(bins);
      const levels: number[] = [];                 // 7 bandes sur la zone de la voix
      for (let b = 0; b < 7; b++) {
        let sum = 0;
        const from = 2 + b * 9;
        for (let k = from; k < from + 9; k++) sum += bins[k] ?? 0;
        levels.push(sum / (9 * 255));
      }
      onLevel(levels);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private enqueue(pcm: Buffer, sampleRate: number) {
    const ctx = this.ctx;
    if (!ctx || !this.analyser) return;
    const n = pcm.length / 2;
    const ab = ctx.createBuffer(1, n, sampleRate);
    const ch = ab.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = pcm.readInt16LE(i * 2) / 32768;
    const src = ctx.createBufferSource();
    src.buffer = ab;
    src.connect(this.analyser);
    const t = Math.max(ctx.currentTime + 0.06, this.nextTime);
    src.start(t);
    this.nextTime = t + ab.duration;
    this.sources.push(src);
    src.onended = () => { this.sources = this.sources.filter(s => s !== src); this.maybeEnd(); };
  }

  private maybeEnd() { if (this.procDone && this.sources.length === 0) this.finish(); }

  private finish() {
    cancelAnimationFrame(this.raf);
    const cb = this.done;
    this.done = null;
    this.analyser = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.proc = null;
    cb?.();
  }

  stop() {
    if (!this.done) return;
    try { this.proc?.kill(); } catch { /* déjà terminé */ }
    for (const s of this.sources) { try { s.stop(); } catch { /* déjà arrêtée */ } }
    this.sources = [];
    this.finish();
  }
}
