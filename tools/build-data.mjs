// Gera data/tabela44.json (dataset inicial do app) a partir dos arquivos
// originais em tools/fontes/ (não versionados: o PDF traz custo de compra).
//
//   node tools/build-data.mjs [tabela.pdf] [tabela.xls]
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import XLSX from 'xlsx';
import { parseTabelaPdf, parseTabelaXls } from '../js/parsers.js';
import { aplicarPdf, aplicarXls } from '../js/dados.js';

const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pdfPath = process.argv[2] || path.join(raiz, 'tools/fontes/tabela44.pdf');
const xlsPath = process.argv[3] || path.join(raiz, 'tools/fontes/tabela44.xls');

async function paginasPdf(file) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    paginas.push(tc.items.map((i) => ({ x: i.transform[4], y: i.transform[5], str: i.str })));
  }
  return paginas;
}

const pdf = parseTabelaPdf(await paginasPdf(pdfPath));
const wb = XLSX.read(fs.readFileSync(xlsPath));
const xls = parseTabelaXls(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }));

let ds = aplicarPdf(null, pdf, path.basename(pdfPath));
// No dataset inicial o PDF é a referência de preço: da planilha vêm só faixas e exceções.
const precoPdf = new Map(ds.produtos.map((p) => [p.codigo, p]));
ds = aplicarXls(ds, xls, path.basename(xlsPath));
ds.produtos = ds.produtos
  .filter((p) => precoPdf.has(p.codigo))
  .map((p) => {
    const o = precoPdf.get(p.codigo);
    return { ...p, preco: o.preco, descricao: o.descricao, um: o.um, peso: o.peso, ipi: o.ipi, emb: o.emb, tipo: o.tipo };
  });
ds.versao = 1;
ds.geradoEm = new Date().toISOString();

const out = path.join(raiz, 'data/tabela44.json');
fs.writeFileSync(out, JSON.stringify(ds));
const exc = ds.produtos.filter((p) => Object.keys(p.excecoes).length).length;
console.log(`Lista: ${pdf.lista} | ref ${pdf.dataRef}`);
console.log(`PDF: ${pdf.produtos.length} produtos | XLS: ${xls.produtos.length} | dataset: ${ds.produtos.length} | com exceção: ${exc}`);
console.log('Faixas:', ds.faixas.map((f) => `${f.nome} ×${f.fator} com ${f.comissao * 100}%`).join(' · '));
console.log(`-> ${path.relative(raiz, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
