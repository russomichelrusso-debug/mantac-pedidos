// Exportação do orçamento: texto (WhatsApp), imagem PNG e PDF.
// Nada de comissão ou faixa de desconto aparece no material do cliente.
import { brl, numero, pct } from './precos.js';

const AZUL = '#004AFF';
const TINTA = '#0B0F19';
const CORPO = '#4A5163';
const LINHA = '#DCE0E8';

const hoje = (d = new Date()) => d.toLocaleDateString('pt-BR');
const nomeArquivo = (orc, ext) => {
  const cli = (orc.cliente || 'cliente').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
  return `Orcamento-Mantac-${cli}-${new Date().toISOString().slice(0, 10)}.${ext}`;
};
const unidade = (p) => p.um || 'un';

function rodape(ds, temSt) {
  const lista = ds?.fontes?.pdf?.lista ? `Tabela ${ds.fontes.pdf.lista.split(' - ')[0]}` : 'Tabela 44';
  const partes = [`Preços ${lista}`, 'Condição de pagamento: 28 DD', 'Valores com IPI' + (temSt ? ' e ICMS-ST (PR)' : '')];
  return partes.join(' · ');
}

// ---------- Texto ----------
export function gerarTexto(orc, linhas, tot, ds) {
  const l = [];
  l.push('*MANTAC* — Orçamento');
  if (orc.cliente) l.push(`Cliente: ${orc.cliente}`);
  l.push(`Vendedor: ${orc.vendedor}`);
  l.push(`Data: ${hoje()}`);
  l.push('');
  linhas.forEach((x, i) => {
    const c = x.calc;
    l.push(`${i + 1}) ${x.prod.codigo} · ${x.prod.descricao}`);
    l.push(`   ${numero(x.qtd)} ${unidade(x.prod)} × ${brl(c.unit)} = ${brl(c.mercadoria)}`);
    const imp = [`IPI ${pct((x.prod.ipi || 0) / 100)}: ${brl(c.ipi)}`];
    if (c.st) imp.push(`ST: ${brl(c.st)}`);
    l.push(`   ${imp.join(' · ')} → *${brl(c.total)}*`);
  });
  l.push('');
  l.push(`Mercadorias: ${brl(tot.mercadoria)}`);
  l.push(`IPI: ${brl(tot.ipi)}`);
  if (tot.st) l.push(`ICMS-ST: ${brl(tot.st)}`);
  l.push(`*TOTAL: ${brl(tot.total)}*`);
  l.push('');
  l.push(`_${rodape(ds, tot.st > 0)}_`);
  return l.join('\n');
}

// ---------- Imagem ----------
function carregarImg(src) {
  return new Promise((ok, erro) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = erro;
    i.src = src;
  });
}

function quebrar(ctx, texto, largura) {
  const palavras = texto.split(/\s+/);
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    const t = atual ? atual + ' ' + p : p;
    if (ctx.measureText(t).width > largura && atual) {
      linhas.push(atual);
      atual = p;
    } else atual = t;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

export async function gerarImagem(orc, linhas, tot, ds) {
  await document.fonts?.ready;
  const W = 1080, M = 56, F = 'Inter, system-ui, sans-serif';
  const logo = await carregarImg('img/logo.png');
  const medir = document.createElement('canvas').getContext('2d');

  // Pré-calcula a altura.
  medir.font = `600 28px ${F}`;
  const blocos = linhas.map((x) => quebrar(medir, `${x.prod.codigo} · ${x.prod.descricao}`, W - 2 * M));
  const altItens = blocos.reduce((s, b) => s + b.length * 36 + 88, 0);
  const H = 300 + altItens + 260 + (tot.st ? 44 : 0);

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = AZUL;
  ctx.fillRect(0, 0, W, 8);

  const lh = 84, lw = (logo.width / logo.height) * lh;
  ctx.drawImage(logo, M, 40, lw, lh);
  ctx.textAlign = 'right';
  ctx.fillStyle = TINTA;
  ctx.font = `700 34px ${F}`;
  ctx.fillText('ORÇAMENTO', W - M, 78);
  ctx.fillStyle = CORPO;
  ctx.font = `400 24px ${F}`;
  ctx.fillText(hoje(), W - M, 114);
  ctx.textAlign = 'left';

  let y = 164;
  ctx.fillStyle = LINHA;
  ctx.fillRect(M, y, W - 2 * M, 2);
  y += 48;
  ctx.fillStyle = CORPO;
  ctx.font = `400 26px ${F}`;
  ctx.fillText('Cliente', M, y);
  ctx.fillText('Vendedor', W / 2 + 20, y);
  y += 36;
  ctx.fillStyle = TINTA;
  ctx.font = `700 28px ${F}`;
  ctx.fillText(orc.cliente || '—', M, y, W / 2 - M);
  ctx.fillText(orc.vendedor, W / 2 + 20, y);
  y += 30;

  linhas.forEach((x, i) => {
    y += 22;
    ctx.fillStyle = LINHA;
    ctx.fillRect(M, y, W - 2 * M, 1);
    y += 42;
    ctx.fillStyle = TINTA;
    ctx.font = `600 28px ${F}`;
    blocos[i].forEach((t, j) => ctx.fillText(t, M, y + j * 36));
    y += blocos[i].length * 36;
    const c = x.calc;
    ctx.font = `400 24px ${F}`;
    ctx.fillStyle = CORPO;
    let det = `${numero(x.qtd)} ${unidade(x.prod)} × ${brl(c.unit)}  ·  IPI ${pct((x.prod.ipi || 0) / 100)}`;
    if (c.st) det += `  ·  ST ${brl(c.st)}`;
    ctx.fillText(det, M, y + 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = TINTA;
    ctx.font = `700 28px ${F}`;
    ctx.fillText(brl(c.total), W - M, y + 2);
    ctx.textAlign = 'left';
    y += 24 - 36 + 36;
  });

  y += 30;
  ctx.fillStyle = TINTA;
  ctx.fillRect(M, y, W - 2 * M, 2);
  y += 50;
  const linhaTot = (rot, val, forte) => {
    ctx.font = `${forte ? 700 : 400} ${forte ? 34 : 26}px ${F}`;
    ctx.fillStyle = forte ? TINTA : CORPO;
    ctx.fillText(rot, M, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = forte ? AZUL : TINTA;
    ctx.fillText(val, W - M, y);
    ctx.textAlign = 'left';
    y += forte ? 56 : 44;
  };
  linhaTot('Mercadorias', brl(tot.mercadoria));
  linhaTot('IPI', brl(tot.ipi));
  if (tot.st) linhaTot('ICMS-ST', brl(tot.st));
  y += 8;
  linhaTot('TOTAL', brl(tot.total), true);
  ctx.fillStyle = CORPO;
  ctx.font = `400 20px ${F}`;
  ctx.fillText(rodape(ds, tot.st > 0), M, H - 36, W - 2 * M);

  const blob = await new Promise((ok) => cv.toBlob(ok, 'image/png'));
  return { blob, nome: nomeArquivo(orc, 'png') };
}

// ---------- PDF ----------
let jspdfPronto;
function carregarJsPdf() {
  const s = (src) => new Promise((ok, erro) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = ok;
    el.onerror = () => erro(new Error('Falha ao carregar ' + src));
    document.head.append(el);
  });
  jspdfPronto ||= s('vendor/jspdf.umd.min.js').then(() => s('vendor/jspdf.plugin.autotable.min.js'));
  return jspdfPronto;
}

async function dataUrl(src) {
  const b = await (await fetch(src)).blob();
  return new Promise((ok) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.readAsDataURL(b);
  });
}

// Fonte padrão do PDF (WinAnsi) não tem alguns símbolos Unicode.
const ansi = (s) => String(s).replace(/[−–]/g, '-').replace(/×/g, 'x').replace(/[“”]/g, '"');

export async function gerarPdf(orc, linhas, tot, ds) {
  await carregarJsPdf();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  const logo = await dataUrl('img/logo.png');
  doc.setFillColor(AZUL);
  doc.rect(0, 0, W, 2, 'F');
  doc.addImage(logo, 'PNG', M, 10, 50, 50 * (100 / 350));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(TINTA);
  doc.text('ORÇAMENTO', W - M, 17, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(CORPO);
  doc.text(hoje(), W - M, 23, { align: 'right' });
  doc.setDrawColor(LINHA);
  doc.line(M, 30, W - M, 30);
  doc.setFontSize(9);
  doc.text('Cliente', M, 37);
  doc.text('Vendedor', W / 2, 37);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(TINTA);
  doc.text(ansi(orc.cliente || '—'), M, 43, { maxWidth: W / 2 - M - 4 });
  doc.text(ansi(orc.vendedor), W / 2, 43);

  const temSt = tot.st > 0;
  const head = ['Código', 'Descrição', 'Qtd', 'Un', 'Unit.', 'IPI', ...(temSt ? ['ST'] : []), 'Total'];
  const body = linhas.map((x) => [
    x.prod.codigo,
    ansi(x.prod.descricao),
    numero(x.qtd),
    unidade(x.prod),
    brl(x.calc.unit),
    pct((x.prod.ipi || 0) / 100),
    ...(temSt ? [brl(x.calc.st)] : []),
    brl(x.calc.total),
  ]);
  const direita = { halign: 'right' };
  doc.autoTable({
    startY: 50,
    head: [head],
    body,
    margin: { left: M, right: M },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: TINTA, lineColor: LINHA, lineWidth: 0.1 },
    headStyles: { fillColor: AZUL, textColor: '#FFFFFF', fontStyle: 'bold' },
    alternateRowStyles: { fillColor: '#F4F6FA' },
    columnStyles: {
      0: { cellWidth: 16 },
      2: direita,
      4: direita,
      5: direita,
      6: direita,
      ...(temSt ? { 7: { ...direita, fontStyle: 'bold' } } : { 6: { ...direita, fontStyle: 'bold' } }),
    },
    theme: 'grid',
  });
  let y = doc.lastAutoTable.finalY + 8;
  if (y > 260) {
    doc.addPage();
    y = 20;
  }
  const tl = (rot, val, forte) => {
    doc.setFont('helvetica', forte ? 'bold' : 'normal');
    doc.setFontSize(forte ? 13 : 10);
    doc.setTextColor(forte ? TINTA : CORPO);
    doc.text(rot, W - M - 60, y);
    doc.setTextColor(forte ? AZUL : TINTA);
    doc.text(brl(val), W - M, y, { align: 'right' });
    y += forte ? 8 : 6;
  };
  tl('Mercadorias', tot.mercadoria);
  tl('IPI', tot.ipi);
  if (temSt) tl('ICMS-ST', tot.st);
  doc.setDrawColor(TINTA);
  doc.line(W - M - 60, y - 3, W - M, y - 3);
  y += 3;
  tl('TOTAL', tot.total, true);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(CORPO);
  doc.text(ansi(rodape(ds, temSt)), M, doc.internal.pageSize.getHeight() - 10);
  return { blob: doc.output('blob'), nome: nomeArquivo(orc, 'pdf') };
}

// ---------- Envio ----------
export async function compartilharArquivo({ blob, nome }, titulo) {
  const file = new File([blob], nome, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: titulo });
      return 'compartilhado';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelado';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'baixado';
}

export async function compartilharTexto(texto) {
  if (navigator.share) {
    try {
      await navigator.share({ text: texto });
      return 'compartilhado';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelado';
    }
  }
  await navigator.clipboard?.writeText(texto);
  return 'copiado';
}
