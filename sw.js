// Gerado por tools/build-sw.mjs — não editar à mão.
const VERSAO = 'mantac-160fbeed7a';
const ARQUIVOS = [
  "./",
  "css/app.css",
  "data/catalogo.json",
  "data/ofertas.json",
  "data/st-pr.json",
  "data/tabela44.json",
  "fonts/inter.woff2",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "img/cat/adaptador-de-rosca-externa-de-reducao.jpg",
  "img/cat/adaptador-interno-rosca-externa.jpg",
  "img/cat/aplicador-de-rejunte-eva-multiuso.jpg",
  "img/cat/bandeja-para-massa-com-aba.jpg",
  "img/cat/caixa-de-luz.jpg",
  "img/cat/caixa-de-massa.jpg",
  "img/cat/caixas-horta-e-pet.jpg",
  "img/cat/canaleta.jpg",
  "img/cat/conduite-pvc-pead.jpg",
  "img/cat/conjunto-de-esguicho.jpg",
  "img/cat/desempenadeiras.jpg",
  "img/cat/engate-flexivel.jpg",
  "img/cat/engate-rapido.jpg",
  "img/cat/entrada-de-maquina.jpg",
  "img/cat/espacador-cruzeta.jpg",
  "img/cat/espatula-culinaria-atoxica.jpg",
  "img/cat/espatula-plastica.jpg",
  "img/cat/joelho-interno-duplo.jpg",
  "img/cat/joelho-interno.jpg",
  "img/cat/joelho-lr-azul-bucha-de-latao.jpg",
  "img/cat/joelho-soldavel-lr.jpg",
  "img/cat/jogos-jardim-ouro-flex.jpg",
  "img/cat/jogos-jardim-pop-plus-trancado.jpg",
  "img/cat/jogos-jardim-super-flexivel.jpg",
  "img/cat/jogos-jardim-trancado-flexivel.jpg",
  "img/cat/jogos-jardim-trancado-giga-flex.jpg",
  "img/cat/jogos-trancado-cristal.jpg",
  "img/cat/kit-jardim-trancado-giga-flex-com-suporte.jpg",
  "img/cat/kit-jardim-trancado-premium-com-suporte.jpg",
  "img/cat/luva-lr-azul-bucha-de-latao.jpg",
  "img/cat/luva-soldavel-lr.jpg",
  "img/cat/mangueira-costal-agricola-psi-80-pulverizacao.jpg",
  "img/cat/mangueira-cristal-incolor.jpg",
  "img/cat/mangueira-de-despejo.jpg",
  "img/cat/mangueira-de-gas-glp-nbr-8613-99.jpg",
  "img/cat/mangueira-especiais-atoxicas.jpg",
  "img/cat/mangueira-jardim-flexivel.jpg",
  "img/cat/mangueira-jardim-pop-plus.jpg",
  "img/cat/mangueira-jardim-premium-antitorcao.jpg",
  "img/cat/mangueira-jardim-super-flexivel.jpg",
  "img/cat/mangueira-jardim-trancada-blue-flex-antitorcao.jpg",
  "img/cat/mangueira-jardim-trancada-cinza-flex.jpg",
  "img/cat/mangueira-jardim-trancada-giga-flex.jpg",
  "img/cat/mangueira-jardim-trancada-ouro-flex.jpg",
  "img/cat/mangueira-jardim-trancada-super-flexivel-pt-150.jpg",
  "img/cat/mangueira-jardim-trancada-tanger-flex.jpg",
  "img/cat/mangueira-jardim-trancada-verde-fechado.jpg",
  "img/cat/mangueira-multiuso.jpg",
  "img/cat/mangueira-para-chuveiro.jpg",
  "img/cat/mangueira-perfil-para-cadeira.jpg",
  "img/cat/mangueira-trancada-pt-1-000-lava-auto.jpg",
  "img/cat/mangueira-trancada-pt-200.jpg",
  "img/cat/mangueira-trancada-pt-250-ar-e-agua.jpg",
  "img/cat/mangueira-trancada-pt-300-ar-e-agua.jpg",
  "img/cat/mangueira-trancada-pt-350-oleo-e-graxa.jpg",
  "img/cat/mangueira-trancada-pt-500-agricola.jpg",
  "img/cat/mangueira-trancada-pt-700-pulverizacao.jpg",
  "img/cat/mangueiras-especiais-para-gasolina.jpg",
  "img/cat/nivelador-e-cunha-niveladora.jpg",
  "img/cat/saida-de-maquina.jpg",
  "img/cat/suporte-para-mangueiras.jpg",
  "img/cat/te-interno-triplo.jpg",
  "img/cat/te-interno.jpg",
  "img/cat/te-lr-azul-bucha-de-latao.jpg",
  "img/cat/te-soldavel-lr.jpg",
  "img/cat/tubo-dreno-para-ar-condicionado.jpg",
  "img/cat/tubo-polietileno.jpg",
  "img/cat/uniao-interna-de-reducao.jpg",
  "img/cat/uniao-interna.jpg",
  "img/logo-wordmark.png",
  "img/logo.png",
  "index.html",
  "js/app.js",
  "js/compartilhar.js",
  "js/dados.js",
  "js/db.js",
  "js/importar.js",
  "js/parsers.js",
  "js/precos.js",
  "manifest.webmanifest",
  "vendor/jspdf.plugin.autotable.min.js",
  "vendor/jspdf.umd.min.js",
  "vendor/pdf.min.mjs",
  "vendor/pdf.worker.min.mjs",
  "vendor/xlsx.full.min.js"
];

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
