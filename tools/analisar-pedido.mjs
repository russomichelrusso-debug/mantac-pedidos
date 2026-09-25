// Confere um ou mais pedidos oficiais (PDF do Prosyst) contra o cálculo do app:
// para cada item, mostra o preço de tabela, a oferta e qual combinação de
// faixa × desconto de pagamento reproduz o preço unitário do pedido.
//
//   node tools/analisar-pedido.mjs pedido1.pdf [pedido2.pdf ...]
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parsePedidoPdf } from '../js/parsers.js';
import { calcularItem, CONFIG_PADRAO, ofertaVigente } from '../js/precos.js';

const ds = JSON.parse(fs.readFileSync('data/tabela44.json'));
const st = JSON.parse(fs.readFileSync('data/st-pr.json'));
const ofertas = JSON.parse(fs.readFileSync('data/ofertas.json'));
const porCodigo = new Map(ds.produtos.map((p) => [p.codigo, p]));

for (const arq of process.argv.slice(2)) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(arq)) }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    paginas.push(tc.items.map((i) => ({ x: i.transform[4], y: i.transform[5], str: i.str })));
  }
  const p = parsePedidoPdf(paginas);
  const ofertaValendo = ofertaVigente(ofertas, p.data || undefined) ? ofertas : null;
  console.log(`\n=== Pedido ${p.numero} · ${p.data} · ${p.cliente} (${p.codigoCliente}) · ${p.condicao} · com. ${p.comissao}%`);
  console.log(`    Obs: ${p.obs || '-'}`);
  console.log(`    Totais: merc ${p.totais.mercadoria} · IPI ${p.totais.ipi} · ST ${p.totais.st} · total ${p.totais.total} · ${p.totais.peso} kg`);
  for (const it of p.itens) {
    const prod = porCodigo.get(it.codigo);
    if (!prod) {
      console.log(`  ${it.codigo.padEnd(6)} ${String(it.unit).padStart(8)}  !! código fora da Tabela 44`);
      continue;
    }
    const achados = [];
    for (const desc of [0, 2, 3, 5]) {
      for (let k = 0; k < ds.faixas.length; k++) {
        for (const comOferta of [true, false]) {
          const cfg = { ...CONFIG_PADRAO, tabelaSt: st, ofertas: comOferta ? ofertaValendo : null, descPagamento: desc };
          if (comOferta && !ofertaValendo) continue;
          const c = calcularItem(prod, ds.faixas, k, 1, cfg);
          if (Math.abs(c.unit - it.unit) < 0.006) achados.push(`${comOferta && c.emOferta ? 'oferta' : 'tabela'}·${ds.faixas[k].nome}${desc ? `·−${desc}%` : ''}`);
        }
      }
    }
    const of = ofertaValendo?.precos?.[it.codigo];
    console.log(`  ${it.codigo.padEnd(6)} ${String(it.unit).padStart(8)}  tab ${String(prod.preco).padStart(7)}  of ${String(of ?? '-').padStart(6)}  ipi ${it.ipi}/${prod.ipi}  st ${it.st}  →  ${[...new Set(achados)].join(' | ') || '?? não bate'}`);
  }
}
