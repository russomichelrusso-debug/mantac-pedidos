// Leitores das planilhas/listas da Mantac. Módulo puro (sem DOM): usado pelo
// app no navegador e pelo script tools/build-data.mjs no Node.

const num = (s) => {
  if (typeof s === 'number') return s;
  if (s == null) return NaN;
  s = String(s).trim();
  if (!s) return NaN;
  // "1.234,56" -> 1234.56 ; "3.25" (IPI) fica como está
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
};
const r2 = (v) => Math.round(Number((v * 100).toPrecision(12))) / 100;
const txt = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normCodigo = (v) => (typeof v === 'number' ? String(Math.round(v)) : txt(v));

// Converte "15/07/26" em "2026-07-15"
const dataIso = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(s);
  if (!m) return null;
  const ano = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${ano}-${m[2]}-${m[1]}`;
};

/**
 * Lê a "Lista de Preços de Venda" (Prosyst) em PDF.
 * @param {Array<Array<{x:number,y:number,str:string}>>} paginas itens de texto por página
 * @returns {{lista:string, dataRef:string|null, produtos:object[]}}
 */
export function parseTabelaPdf(paginas) {
  const produtos = [];
  let lista = '';
  let dataRef = null;
  let classe = '';
  let tipo = '';

  for (const itens of paginas) {
    const vistos = itens.filter((i) => i.str && i.str.trim());
    for (const i of vistos) {
      const s = txt(i.str);
      if (!lista && /^Lista:/i.test(s)) lista = s.replace(/^Lista:\s*/i, '');
      const ref = /Data de refer[êe]ncia:\s*(\S+)/i.exec(s);
      if (ref && !dataRef) dataRef = dataIso(ref[1]);
    }

    // Âncoras: códigos na margem esquerda + cabeçalhos de classe/tipo.
    const ancoras = [];
    for (const i of vistos) {
      const s = txt(i.str);
      if (i.x < 60) {
        let m;
        if ((m = /^Classe:\s*(\d+)\s*-\s*(.+)$/i.exec(s))) ancoras.push({ y: i.y, kind: 'classe', v: m[2].trim() });
        else if ((m = /^Tipo:\s*(\d+)\s*-\s*(.+)$/i.exec(s))) ancoras.push({ y: i.y, kind: 'tipo', v: m[2].trim() });
        else if (/^[0-9][0-9A-Za-z-]*$/.test(s)) ancoras.push({ y: i.y, kind: 'prod', codigo: s, itens: [] });
      }
    }
    const prods = ancoras.filter((a) => a.kind === 'prod');
    for (const i of vistos) {
      if (i.x < 60) continue;
      let melhor = null;
      let dist = 4.5;
      for (const a of prods) {
        const d = Math.abs(a.y - i.y);
        if (d < dist) { dist = d; melhor = a; }
      }
      // Descrição longa quebra em uma segunda linha logo abaixo do código.
      if (!melhor && i.x < 205) {
        dist = 14;
        for (const a of prods) {
          const d = a.y - i.y;
          if (d > 0 && d < dist) { dist = d; melhor = a; }
        }
        if (melhor) i.continuacao = true;
      }
      if (melhor) melhor.itens.push(i);
    }
    // Ordem de leitura: de cima para baixo (y decrescente no PDF).
    ancoras.sort((a, b) => b.y - a.y);
    for (const a of ancoras) {
      if (a.kind === 'classe') { classe = a.v; continue; }
      if (a.kind === 'tipo') { tipo = a.v; continue; }
      const p = { codigo: a.codigo, descricao: '', um: '', peso: null, ipi: null, ncm: '', vigencia: null, emb: null, preco: null, classe, tipo };
      const desc = [];
      for (const i of a.itens.sort((u, v) => (u.continuacao ? 1 : 0) - (v.continuacao ? 1 : 0) || u.x - v.x)) {
        const s = txt(i.str);
        if (i.x < 205) { desc.push(s); continue; }
        if (i.x < 228 && /^[a-zçA-ZÇ]{1,4}$/.test(s) && !p.um) { p.um = s.toLowerCase(); continue; }
        if (/^\d+,\d{4}$/.test(s) && p.peso == null) { p.peso = num(s); continue; }
        if (/^\d+\.\d{2}$/.test(s) && p.ipi == null) { p.ipi = Number(s); continue; }
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) { p.ncm = s; continue; }
        if (/^\d{2}\/\d{2}\/\d{2}$/.test(s)) { p.vigencia = dataIso(s); continue; }
        if (/^\d+$/.test(s) && i.x > 355 && i.x < 412) { p.emb = Number(s); continue; }
        if (/^[\d.]+,\d{5}$/.test(s)) { p.preco = r2(num(s)); continue; }
        // Promocional, custo de compra e condição de pagamento são ignorados.
      }
      p.descricao = txt(desc.join(' '));
      if (p.preco != null && p.descricao) produtos.push(p);
    }
  }
  return { lista, dataRef, produtos };
}

/**
 * Lê a planilha "tabela 44 com 2X10 comissão 8 com 3x10 comissão 5".
 * @param {any[][]} linhas linhas da primeira aba (SheetJS sheet_to_json header:1)
 * @returns {{faixas:object[], produtos:object[]}}
 */
export function parseTabelaXls(linhas) {
  const hdr = linhas.findIndex((l) => l.some((c) => /^C[óo]d\.?$/i.test(txt(c))));
  if (hdr < 0) throw new Error('Cabeçalho "Cód." não encontrado na planilha.');
  const H = linhas[hdr].map((c) => txt(c).toLowerCase());
  const col = (re, from = 0) => H.findIndex((c, i) => i >= from && re.test(c));
  const cCod = col(/^c[óo]d/);
  const cDesc = col(/^descri/);
  const cUm = col(/^um$/);
  const cPeso = col(/^peso/);
  const cIpi = col(/ipi/);
  const cEmb = col(/^embal/);
  const cUnit = col(/^pre[çc]o unit/);
  const cPm = H.lastIndexOf('pm');
  const cPrecos = H.map((c, i) => (c === 'preço' || c === 'preco' ? i : -1)).filter((i) => i >= 0);
  if (cCod < 0 || cDesc < 0 || cPrecos.length === 0) throw new Error('Colunas esperadas (Cód., Descrição, Preço) não encontradas.');

  // Comissões na linha acima do cabeçalho, descontos na linha abaixo.
  const acima = linhas[hdr - 1] || [];
  const abaixo = linhas[hdr + 1] || [];
  let fator = 1;
  const faixas = cPrecos.map((c, k) => {
    const d = num(abaixo[c]);
    if (k > 0 && d > 0 && d < 1) fator *= 1 - d;
    const com = num(acima[c]);
    return { fator: Math.round(fator * 1e6) / 1e6, comissao: Number.isFinite(com) ? com : null };
  });

  const produtos = [];
  let classe = '';
  for (let r = hdr + 1; r < linhas.length; r++) {
    const l = linhas[r];
    const cod = normCodigo(l[cCod]);
    if (!cod) continue;
    const m = /Tipo:\s*\d+\s*-\s*(.+)$/i.exec(cod);
    if (m) { classe = m[1].trim(); continue; }
    if (!/^[0-9][0-9A-Za-z-]*$/.test(cod)) continue;
    const precos = cPrecos.map((c) => num(l[c]));
    const unit = num(l[cUnit]);
    const base = Number.isFinite(precos[0]) && precos[0] > 0 ? precos[0] : unit;
    if (!(base > 0)) continue;
    // Preços digitados à mão (fora da fórmula) viram exceções por faixa.
    const excecoes = {};
    precos.forEach((v, k) => {
      if (k === 0 || !Number.isFinite(v) || !(v > 0)) return;
      if (Math.abs(v - base * faixas[k].fator) > 0.005) excecoes[k] = r2(v);
    });
    produtos.push({
      codigo: cod,
      descricao: txt(l[cDesc]),
      um: txt(l[cUm]).toLowerCase(),
      peso: num(l[cPeso]) || null,
      ipi: Number.isFinite(num(l[cIpi])) ? num(l[cIpi]) : null,
      emb: num(l[cEmb]) || null,
      preco: r2(base),
      pm: Number.isFinite(num(l[cPm])) && num(l[cPm]) > 0 ? num(l[cPm]) : null,
      excecoes,
      tipo: classe,
    });
  }
  return { faixas, produtos };
}

/**
 * Lê a tabela de ICMS-ST do PR por produto ("PR ST … MANTAC"), com colunas
 * Cód. · Material · UM · Peso · NCM · ICMS interno · MVA · %ST · CEST.
 * @returns {{produtos: {codigo:string, ncm:string, st:boolean, aliqInterna:number|null, mva:number|null, pst:number|null, cest:string|null}[]}}
 */
export function parseStPdf(paginas) {
  const produtos = [];
  const pctNum = (s) => Number(s.replace('%', '').replace('.', '').replace(',', '.'));
  for (const itens of paginas) {
    const linhas = [];
    for (const i of itens.filter((x) => x.str && x.str.trim())) {
      let l = linhas.find((x) => Math.abs(x.y - i.y) < 2.5);
      if (!l) linhas.push((l = { y: i.y, itens: [] }));
      l.itens.push(i);
    }
    for (const l of linhas) {
      l.itens.sort((a, b) => a.x - b.x);
      const primeiro = txt(l.itens[0].str);
      if (l.itens[0].x > 45 || !/^[0-9][0-9A-Za-z-]*$/.test(primeiro)) continue;
      const resto = l.itens.slice(1).map((i) => txt(i.str));
      const ncm = resto.find((s) => /^\d{2}\.\d{2}\.\d{4}$/.test(s));
      if (!ncm) continue;
      const juntos = resto.join(' ');
      const pcts = resto.filter((s) => /^\d+,\d+%$/.test(s)).map(pctNum);
      const semSt = /N[ÃA]O POSSUI ST/i.test(juntos);
      const cest = resto.find((s) => /^\d{2}\.\d{3}\.\d{2}$/.test(s)) || null;
      produtos.push({
        codigo: primeiro,
        ncm,
        st: !semSt && pcts.length >= 2,
        aliqInterna: pcts[0] ?? null,
        mva: semSt ? null : pcts[1] ?? null,
        pst: semSt ? null : pcts[2] ?? null,
        cest: semSt ? null : cest,
      });
    }
  }
  return { produtos };
}

/** Diz se as páginas parecem a tabela de ST (e não a lista de preços). */
export function pareceTabelaSt(paginas) {
  const cab = (paginas[0] || []).map((i) => i.str).join(' ');
  return /%ST/.test(cab) && /MVA/.test(cab) && !/Lista de Pre[çc]os/i.test(cab);
}
