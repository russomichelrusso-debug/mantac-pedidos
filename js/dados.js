// Monta o dataset ativo do app a partir das leituras de PDF e/ou XLS.
// Módulo puro, compartilhado entre navegador e tools/build-data.mjs.

export const FAIXAS_PADRAO = [
  { id: 't0', nome: 'Tabela', fator: 1, comissao: 0.08 },
  { id: 't1', nome: '−10%', fator: 0.9, comissao: 0.08 },
  { id: 't2', nome: '2×10', fator: 0.81, comissao: 0.08 },
  { id: 't3', nome: '3×10', fator: 0.729, comissao: 0.05 },
];

function nomeFaixa(k, fator) {
  if (k === 0) return 'Tabela';
  const pct = Math.round((1 - fator) * 1000) / 10;
  const n = Math.round(Math.log(fator) / Math.log(0.9));
  if (Math.abs(Math.pow(0.9, n) - fator) < 1e-4) return n === 1 ? '−10%' : `${n}×10`;
  return `−${String(pct).replace('.', ',')}%`;
}

export function faixasDoXls(xls) {
  return xls.faixas.map((f, k) => ({
    id: 't' + k,
    nome: nomeFaixa(k, f.fator),
    fator: f.fator,
    comissao: f.comissao ?? FAIXAS_PADRAO[k]?.comissao ?? 0,
  }));
}

const limpa = (p) => ({
  codigo: p.codigo,
  descricao: p.descricao,
  um: p.um || '',
  peso: p.peso ?? null,
  ipi: p.ipi ?? 0,
  ncm: p.ncm || '',
  vigencia: p.vigencia || null,
  emb: p.emb || 1,
  preco: p.preco,
  classe: p.classe || '',
  tipo: p.tipo || '',
  excecoes: p.excecoes || {},
});

/** Aplica uma lista em PDF sobre o dataset atual (substitui a lista de produtos). */
export function aplicarPdf(atual, pdf, arquivo) {
  const antigos = new Map((atual?.produtos || []).map((p) => [p.codigo, p]));
  const produtos = pdf.produtos.map((p) => limpa({ ...p, excecoes: antigos.get(p.codigo)?.excecoes }));
  return {
    ...(atual || {}),
    faixas: atual?.faixas || FAIXAS_PADRAO,
    fontes: { ...(atual?.fontes || {}), pdf: { arquivo, lista: pdf.lista, dataRef: pdf.dataRef, em: new Date().toISOString() } },
    produtos,
  };
}

/** Aplica a planilha XLS: faixas/comissões, exceções e preços dos códigos presentes. */
export function aplicarXls(atual, xls, arquivo) {
  const porCodigo = new Map((atual?.produtos || []).map((p) => [p.codigo, { ...p }]));
  for (const x of xls.produtos) {
    const p = porCodigo.get(x.codigo);
    if (p) {
      p.preco = x.preco;
      p.excecoes = x.excecoes;
      if (x.descricao) p.descricao = x.descricao;
      if (x.emb) p.emb = x.emb;
      if (x.peso) p.peso = x.peso;
      if (x.ipi != null) p.ipi = x.ipi;
    } else {
      porCodigo.set(x.codigo, limpa({ ...x, classe: '', tipo: x.tipo }));
    }
  }
  // Códigos ausentes na planilha mantêm o preço, mas perdem exceções antigas.
  const noXls = new Set(xls.produtos.map((x) => x.codigo));
  for (const p of porCodigo.values()) if (!noXls.has(p.codigo)) p.excecoes = {};
  return {
    ...(atual || {}),
    faixas: faixasDoXls(xls),
    fontes: { ...(atual?.fontes || {}), xls: { arquivo, em: new Date().toISOString() } },
    produtos: [...porCodigo.values()],
  };
}

/** Resumo de diferenças para mostrar antes de confirmar uma importação. */
export function comparar(antes, depois) {
  const a = new Map((antes?.produtos || []).map((p) => [p.codigo, p]));
  const d = new Map((depois?.produtos || []).map((p) => [p.codigo, p]));
  let novos = 0, removidos = 0, precoAlterado = 0;
  for (const [c, p] of d) {
    const o = a.get(c);
    if (!o) novos++;
    else if (Math.abs(o.preco - p.preco) > 0.001) precoAlterado++;
  }
  for (const c of a.keys()) if (!d.has(c)) removidos++;
  return { total: d.size, novos, removidos, precoAlterado };
}
