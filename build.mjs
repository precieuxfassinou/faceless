import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

// 1. Icônes Phosphor (regular) : nom → contenu du <svg>, embarqué dans main.js
const dir = 'node_modules/@phosphor-icons/core/assets/regular';
const icons = {};
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.svg')) continue;
  const svg = fs.readFileSync(path.join(dir, f), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  icons[f.slice(0, -4)] = inner;
}
fs.writeFileSync('src/phosphor-data.json', JSON.stringify(icons));

// 2. Vérifie que chaque icône utilisée existe
const used = new Set();
for (const f of fs.readdirSync('src').filter(f => f.endsWith('.ts'))) {
  for (const m of fs.readFileSync(path.join('src', f), 'utf8').matchAll(/['"]ph-([a-z0-9-]+)['"]/g)) used.add(m[1]);
}
const missing = [...used].filter(n => !icons[n]);
if (missing.length) { console.error('Icônes Phosphor inconnues :', missing.join(', ')); process.exit(1); }

// 3. Polices embarquées en base64 (hors ligne)
const font = (p) => fs.readFileSync(p).toString('base64');
const cp = (w) => font(`node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-${w}-normal.woff2`);
const faces = [400, 500, 600].map(w => `@font-face { font-family: 'Faceless Sans'; font-style: normal; font-weight: ${w}; font-display: swap;
  src: url(data:font/woff2;base64,${cp(w)}) format('woff2'); }`).join('\n') + `
@font-face { font-family: 'Faceless Mono'; font-style: normal; font-weight: 400; font-display: swap;
  src: url(data:font/woff2;base64,${font('node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Faceless Mono'; font-style: normal; font-weight: 500; font-display: swap;
  src: url(data:font/woff2;base64,${font('node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2')}) format('woff2'); }
`;
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/styles.css', faces + fs.readFileSync('styles.src.css', 'utf8'));
fs.copyFileSync('manifest.json', 'dist/manifest.json');

await esbuild.build({
  entryPoints: ['src/main.ts'], bundle: true, outfile: 'dist/main.js', format: 'cjs', target: 'es2020',
  platform: 'browser', minify: true, sourcemap: false, logLevel: 'info',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', 'child_process', 'fs', 'path', 'os'],
});
