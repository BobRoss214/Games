// Static build: copies the game (index.html, style.css, game.js, src/) into dist/. No bundler needed; the folder is deployable as-is.
import { cpSync, mkdirSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url))), dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist, { recursive: true });
for (const f of ['index.html', 'style.css', 'game.js']) cpSync(join(root, f), join(dist, f));
cpSync(join(root, 'src'), join(dist, 'src'), { recursive: true });
let bytes = 0, files = 0; const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n), s = statSync(p); if (s.isDirectory()) walk(p); else { bytes += s.size; files++; } } }; walk(dist);
writeFileSync(join(dist, 'build-info.json'), JSON.stringify({ name: 'graveward', built: new Date().toISOString(), files, bytes }, null, 2));
console.log(`built dist/ : ${files} files, ${(bytes / 1024).toFixed(0)} KB. Serve it with any static server (e.g. python3 -m http.server -d dist 8000).`);
