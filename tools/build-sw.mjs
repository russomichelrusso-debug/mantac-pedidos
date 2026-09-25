// Gera sw.js com a lista de arquivos para funcionamento offline e uma versão
// derivada do conteúdo (muda sempre que qualquer arquivo publicado mudar).
//
//   node tools/build-sw.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pastas = ['css', 'js', 'data', 'fonts', 'icons', 'img', 'vendor'];
const soltos = ['index.html', 'manifest.webmanifest'];

const listar = (dir) =>
  fs.readdirSync(path.join(raiz, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listar(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const arquivos = [...soltos, ...pastas.flatMap(listar)]
  .filter((f) => !/\.(map|md)$/.test(f))
  .map((f) => f.split(path.sep).join('/'))
  .sort();

const hash = crypto.createHash('sha256');
for (const f of arquivos) hash.update(f).update(fs.readFileSync(path.join(raiz, f)));
const versao = hash.digest('hex').slice(0, 10);

const sw = `// Gerado por tools/build-sw.mjs — não editar à mão.
const VERSAO = 'mantac-${versao}';
const ARQUIVOS = ${JSON.stringify(['./', ...arquivos], null, 2)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('mantac-') && k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Dados: rede primeiro (pega tabela nova), cache se offline. Resto: cache primeiro.
  const dados = new URL(req.url).pathname.includes('/data/');
  e.respondWith(
    dados
      ? fetch(req).then((r) => { const c = r.clone(); caches.open(VERSAO).then((k) => k.put(req, c)); return r; })
          .catch(() => caches.match(req, { ignoreSearch: true }))
      : caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req).catch(() => caches.match('./index.html')))
  );
});
`;
fs.writeFileSync(path.join(raiz, 'sw.js'), sw);
console.log(`sw.js: ${arquivos.length} arquivos, versão ${versao}`);
