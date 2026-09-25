// Leitura de arquivos enviados no painel (PDF da lista e planilha XLS/XLSX).
import { parseTabelaPdf, parseTabelaXls } from './parsers.js';

let pdfjs;
async function carregarPdfJs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

function carregarScript(src) {
  return new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => erro(new Error('Falha ao carregar ' + src));
    document.head.append(s);
  });
}

export async function lerPdf(arquivo) {
  const lib = await carregarPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    paginas.push(tc.items.map((i) => ({ x: i.transform[4], y: i.transform[5], str: i.str })));
  }
  const r = parseTabelaPdf(paginas);
  if (!r.produtos.length) throw new Error('Nenhum produto reconhecido. O arquivo é a "Lista de Preços de Venda" do Prosyst?');
  return r;
}

export async function lerXls(arquivo) {
  if (!window.XLSX) await carregarScript(new URL('../vendor/xlsx.full.min.js', import.meta.url).href);
  const wb = window.XLSX.read(await arquivo.arrayBuffer());
  const aba = wb.Sheets[wb.SheetNames[0]];
  const r = parseTabelaXls(window.XLSX.utils.sheet_to_json(aba, { header: 1, raw: true, defval: '' }));
  if (!r.produtos.length) throw new Error('Nenhum produto reconhecido na planilha.');
  return r;
}
