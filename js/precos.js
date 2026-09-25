// Cálculo de preço por faixa de desconto + IPI + ICMS-ST (cliente no PR).
//
// Preço da Tabela 44 = preço unitário já com ICMS (conforme o PDF).
// 1. Faixa: preço × fator da faixa (ou preço digitado na planilha, se houver).
// 2. IPI: sobre o valor da mercadoria, alíquota do item.
// 3. ICMS-ST, por código, conforme a tabela "PR ST" da Mantac (MVA do item):
//      BC-ST = (mercadoria + IPI*) × (1 + MVA)          *se "IPI na base" ligado
//      ST    = BC-ST × ICMS interno PR − mercadoria × ICMS interestadual
//    Produto fora da tabela de ST usa a MVA por NCM do painel, se houver.

export const r2 = (v) => Math.round(Number((v * 100).toPrecision(12))) / 100;

export const CONFIG_PADRAO = {
  vendedor: 'RUSSO',
  st: {
    aliqInterna: 19.5, // ICMS interno PR (%) — usado quando a tabela de ST não traz
    aliqInter: 12, // ICMS interestadual SC → PR (%)
    ipiNaBase: true, // IPI compõe a base da ST (regra legal)
    ncms: {}, // MVA por NCM, só para produtos fora da tabela de ST: { "39.17.3229": { mva: 39 } }
    semSt: [], // códigos excluídos da ST em qualquer caso
  },
};

export function precoUnitario(prod, faixa, k) {
  const exc = prod.excecoes?.[k];
  return exc != null ? exc : r2(prod.preco * faixa.fator);
}

/**
 * Situação de ST do produto: { mva, aliqInterna, cest, origem } ou null (sem ST).
 * `cfg.tabelaSt` é a tabela por código (data/st-pr.json ou importada no painel).
 */
export function regraSt(prod, cfg) {
  const st = cfg?.st;
  if (!st || st.semSt?.includes(prod.codigo)) return null;
  const tab = cfg.tabelaSt?.porCodigo;
  if (tab && prod.codigo in tab) {
    const r = tab[prod.codigo];
    return r && r.mva != null ? { ...r, origem: 'tabela' } : null;
  }
  const regra = st.ncms?.[prod.ncm];
  return regra && regra.mva != null && regra.mva !== '' ? { mva: regra.mva, origem: 'ncm' } : null;
}

/** 'sim' | 'nao' | 'indefinido' (produto fora da tabela de ST e sem regra por NCM). */
export function situacaoSt(prod, cfg) {
  if (regraSt(prod, cfg)) return 'sim';
  const tab = cfg?.tabelaSt?.porCodigo;
  if (!tab || prod.codigo in tab || cfg.st?.semSt?.includes(prod.codigo)) return 'nao';
  return 'indefinido';
}

/** Calcula um item do orçamento (ou uma simulação de 1 embalagem). */
export function calcularItem(prod, faixas, k, qtd, cfg) {
  const faixa = faixas[k] || faixas[0];
  const unit = precoUnitario(prod, faixa, k);
  const mercadoria = r2(unit * qtd);
  const ipi = r2(mercadoria * (prod.ipi || 0) / 100);
  let st = 0;
  const regra = regraSt(prod, cfg);
  if (regra) {
    const base = mercadoria + (cfg.st.ipiNaBase === false ? 0 : ipi);
    const bc = base * (1 + Number(regra.mva) / 100);
    const interna = regra.aliqInterna ?? cfg.st.aliqInterna;
    st = r2(Math.max(0, bc * interna / 100 - mercadoria * cfg.st.aliqInter / 100));
  }
  const total = r2(mercadoria + ipi + st);
  return {
    unit,
    mercadoria,
    ipi,
    st,
    total,
    unitFinal: qtd ? total / qtd : 0,
    comissaoPct: faixa.comissao,
    comissao: r2(mercadoria * faixa.comissao),
    temSt: !!regra,
    mva: regra ? Number(regra.mva) : null,
  };
}

export function totalizar(linhas) {
  const t = { mercadoria: 0, ipi: 0, st: 0, total: 0, comissao: 0 };
  for (const l of linhas) for (const k of Object.keys(t)) t[k] = r2(t[k] + l.calc[k]);
  return t;
}

/** Ajusta a quantidade para o múltiplo da embalagem (arredonda para cima). */
export function multiploEmb(qtd, emb) {
  const e = emb > 0 ? emb : 1;
  const q = Math.ceil(Math.max(0, Number(qtd) || 0) / e - 1e-9) * e;
  return Math.max(e, q);
}

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
export const brl = (v) => fmtBRL.format(v || 0);
export const numero = (v) => fmtNum.format(v || 0);
const fmtPct = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
export const pct = (v) => `${fmtPct.format(Math.round(v * 10000) / 100)}%`;
