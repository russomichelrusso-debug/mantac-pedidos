import * as db from './db.js';
import { CONFIG_PADRAO, calcularItem, totalizar, multiploEmb, brl, numero, pct } from './precos.js';
import { aplicarPdf, aplicarXls, comparar } from './dados.js';
import { gerarTexto, gerarImagem, gerarPdf, compartilharArquivo, compartilharTexto } from './compartilhar.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[”“″]/g, '"').replace(/½/g, '1/2');
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const ICONES = {
  mais: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  menos: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  voltar: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
};

const estado = {
  ds: null,
  cat: { linhas: [], itens: {} },
  cfg: structuredClone(CONFIG_PADRAO),
  orc: { cliente: '', vendedor: CONFIG_PADRAO.vendedor, itens: [] },
  busca: '',
  classe: '',
  limite: 60,
  detalhe: null, // { codigo, k, qtd }
  previa: null,
};
let indice = [];
let porCodigo = new Map();

// ---------- Carga ----------
async function carregarEmbutido() {
  const r = await fetch('data/tabela44.json', { cache: 'no-cache' });
  const ds = await r.json();
  ds.origem = 'embutido';
  return ds;
}

async function iniciar() {
  const [cfg, orc, ds] = await Promise.all([db.ler('cfg'), db.ler('orc'), db.ler('ds')]).catch(() => []);
  if (cfg) estado.cfg = { ...structuredClone(CONFIG_PADRAO), ...cfg, st: { ...CONFIG_PADRAO.st, ...cfg.st } };
  if (orc) estado.orc = orc;
  estado.orc.vendedor ||= estado.cfg.vendedor;
  // Enquanto não houver importação manual, usa sempre a tabela publicada no app.
  if (ds && ds.origem === 'upload') estado.ds = ds;
  else {
    try {
      estado.ds = await carregarEmbutido();
    } catch {
      estado.ds = ds;
    }
  }
  try {
    estado.cat = await (await fetch('data/catalogo.json')).json();
  } catch { /* catálogo técnico é opcional */ }
  indexar();
  ligarEventos();
  renderTudo();
  irPara(location.hash.slice(1) || 'consulta', false);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function linhaCatalogo(codigo) {
  const ref = estado.cat.itens?.[codigo];
  if (!ref) return null;
  const linha = estado.cat.linhas[ref[0]];
  const tab = linha?.tabelas[ref[1]];
  const row = tab?.linhas.find((r) => r[0] === codigo);
  return linha ? { linha, tab, row } : null;
}

function indexar() {
  porCodigo = new Map(estado.ds.produtos.map((p) => [p.codigo, p]));
  indice = estado.ds.produtos.map((p) => {
    const lc = linhaCatalogo(p.codigo);
    return { p, chave: norm(`${p.codigo} ${p.descricao} ${p.classe} ${p.tipo} ${lc?.linha.titulo || ''}`) };
  });
}

const salvarOrc = () => db.gravar('orc', estado.orc).catch(() => {});
const salvarCfg = () => db.gravar('cfg', estado.cfg).catch(() => {});

function aviso(msg) {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('on'), 2600);
}

// ---------- Navegação ----------
function irPara(vista, push = true) {
  if (!['consulta', 'orcamento', 'painel'].includes(vista)) vista = 'consulta';
  document.querySelectorAll('.vista').forEach((v) => (v.hidden = v.dataset.vista !== vista));
  document.querySelectorAll('.aba').forEach((b) => (b.dataset.ir === vista ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (push) history.replaceState(null, '', '#' + vista);
  if (vista === 'orcamento') renderOrcamento();
  if (vista === 'painel') renderPainel();
  window.scrollTo(0, 0);
}

// ---------- Consulta ----------
function renderTudo() {
  const f = estado.ds.fontes?.pdf;
  $('#topo-info').textContent = `${f?.lista ? 'Tabela ' + f.lista.split(' - ')[0] : 'Tabela 44'} · ${dataBR(f?.dataRef)}`;
  renderClasses();
  renderResultados();
  renderBadge();
}

function renderClasses() {
  const cont = new Map();
  for (const p of estado.ds.produtos) cont.set(p.classe || 'Outros', (cont.get(p.classe || 'Outros') || 0) + 1);
  const bt = (v, rot) => `<button type="button" data-classe="${esc(v)}" aria-pressed="${estado.classe === v}">${esc(rot)}</button>`;
  $('#classes').innerHTML = bt('', 'Todas') + [...cont.keys()].map((c) => bt(c, c)).join('');
}

function filtrar() {
  const termos = norm(estado.busca).split(/\s+/).filter(Boolean);
  let r = indice.filter((x) => (!estado.classe || (x.p.classe || 'Outros') === estado.classe) && termos.every((t) => x.chave.includes(t)));
  if (termos.length === 1) {
    const t = termos[0];
    r = [...r.filter((x) => norm(x.p.codigo) === t), ...r.filter((x) => norm(x.p.codigo) !== t && norm(x.p.codigo).startsWith(t)), ...r.filter((x) => !norm(x.p.codigo).startsWith(t))];
  }
  return r.map((x) => x.p);
}

function precoBase(p) {
  return calcularItem(p, estado.ds.faixas, 0, 1, estado.cfg);
}

function renderResultados() {
  const r = filtrar();
  $('#contagem').textContent = `${r.length} produto${r.length === 1 ? '' : 's'}${estado.busca || estado.classe ? ' encontrados' : ''}`;
  const lista = r.slice(0, estado.limite);
  $('#resultados').innerHTML = lista.length
    ? lista
        .map((p) => {
          const c = precoBase(p);
          const tec = estado.cat.itens?.[p.codigo] ? '<span class="tag">Ficha</span>' : '';
          const st = c.temSt ? '<span class="tag tag--st">ST</span>' : '';
          return `<li class="item">
            <button class="item__abrir" data-abrir="${esc(p.codigo)}">
              <span class="item__cod">${esc(p.codigo)}${tec}${st}</span>
              <span class="item__desc">${esc(p.descricao)}</span>
              <span class="item__meta">Emb. ${numero(p.emb)} ${esc(p.um)} · IPI ${pct(p.ipi / 100)}</span>
            </button>
            <div class="item__preco"><b>${brl(c.unit)}</b><span>/${esc(p.um)} · c/ imp. ${brl(c.unitFinal)}</span></div>
            <button class="btn-icone btn-icone--azul" data-rapido="${esc(p.codigo)}" aria-label="Adicionar ${esc(p.codigo)} ao orçamento">${ICONES.mais}</button>
          </li>`;
        })
        .join('')
    : `<li class="vazio"><b>Nada encontrado</b>Tente outro código ou parte da descrição.</li>`;
  $('#mais').hidden = r.length <= estado.limite;
}

// ---------- Detalhe ----------
function abrirDetalhe(codigo) {
  const p = porCodigo.get(codigo);
  if (!p) return;
  const noOrc = estado.orc.itens.find((i) => i.codigo === codigo);
  estado.detalhe = { codigo, k: noOrc?.k ?? 0, qtd: noOrc?.qtd ?? p.emb };
  renderDetalhe();
  $('#folha').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#detalhe').scrollTop = 0;
  $('#detalhe').focus?.();
}

function fecharDetalhe() {
  $('#folha').hidden = true;
  document.body.style.overflow = '';
  estado.detalhe = null;
}

function renderDetalhe() {
  soltarFoco();
  const d = estado.detalhe;
  const p = porCodigo.get(d.codigo);
  const faixas = estado.ds.faixas;
  const lc = linhaCatalogo(p.codigo);
  const calc = calcularItem(p, faixas, d.k, d.qtd, estado.cfg);
  const noOrc = estado.orc.itens.some((i) => i.codigo === p.codigo);

  const linhasFaixa = faixas
    .map((f, k) => {
      const c = calcularItem(p, faixas, k, 1, estado.cfg);
      return `<tr data-faixa="${k}" aria-selected="${k === d.k}">
        <td><b>${esc(f.nome)}</b></td><td>${brl(c.unit)}</td><td><b>${brl(c.unitFinal)}</b></td><td class="com">${pct(f.comissao)}</td></tr>`;
    })
    .join('');

  let tecnico = '';
  if (lc) {
    const { linha, tab, row } = lc;
    const specs = row ? tab.colunas.slice(1).map((col, i) => [col, row[i + 1]]).filter(([, v]) => v) : [];
    const irmaos = (linha.tabelas || []).flatMap((t) => t.linhas.map((r) => r[0])).filter((c) => porCodigo.has(c));
    tecnico = `
      <h3 class="subtitulo">Ficha técnica</h3>
      ${specs.length ? `<dl class="dados">${specs.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      <div class="texto" style="margin-top:16px">
        <p><b>${esc(linha.titulo)}</b>${linha.texto ? ' — ' + esc(linha.texto) : ''}</p>
        ${linha.aplicacao ? `<p><b>Aplicação:</b> ${esc(linha.aplicacao)}</p>` : ''}
        ${linha.caracteristicas ? `<p><b>Características técnicas:</b> ${esc(linha.caracteristicas)}</p>` : ''}
        ${linha.cores ? `<p><b>Cores:</b> ${esc(linha.cores)}</p>` : ''}
        <p class="mudo" style="font-size:13px">Catálogo Mantac 2025, p. ${linha.pagina}</p>
      </div>
      ${irmaos.length > 1 ? `<h3 class="subtitulo">Outros itens da linha</h3><div class="irmaos">${irmaos.map((c) => `<button data-abrir="${esc(c)}" aria-current="${c === p.codigo}">${esc(c)}</button>`).join('')}</div>` : ''}`;
  }

  $('#detalhe').innerHTML = `
    <div class="folha__barra">
      <button class="btn-icone" data-acao="fechar" aria-label="Fechar">${ICONES.voltar}</button>
      <span class="rotulo">Produto</span>
      <span style="width:44px"></span>
    </div>
    ${lc?.linha.img ? `<div class="det__foto"><img src="${esc(lc.linha.img)}" alt="${esc(lc.linha.titulo)}" loading="lazy"></div>` : ''}
    <div class="det__cab">
      <span class="item__cod">${esc(p.codigo)}</span>
      <h2 id="det-titulo">${esc(p.descricao)}</h2>
      <span class="mudo" style="font-size:14px">${esc(p.classe)}${p.tipo ? ' · ' + esc(p.tipo) : ''}</span>
    </div>

    <h3 class="subtitulo">Preço por ${esc(p.um || 'un')}</h3>
    <table class="faixas">
      <thead><tr><th>Faixa</th><th>Unit.</th><th>C/ impostos</th><th>Comissão</th></tr></thead>
      <tbody>${linhasFaixa}</tbody>
    </table>
    <p class="mudo" style="font-size:13px;margin:8px 0 0">C/ impostos = unitário + IPI ${pct(p.ipi / 100)}${calc.temSt ? ' + ICMS-ST' : ''}. Preço de tabela já inclui ICMS.</p>

    <div class="adicionar">
      <div class="adicionar__linha">
        <div class="qtd">
          <button class="btn-icone" data-qtd="-1" aria-label="Diminuir">${ICONES.menos}</button>
          <input id="det-qtd" type="number" inputmode="decimal" min="${p.emb}" step="${p.emb}" value="${d.qtd}" aria-label="Quantidade em ${esc(p.um)}">
          <button class="btn-icone" data-qtd="1" aria-label="Aumentar">${ICONES.mais}</button>
          <span class="qtd__un">${esc(p.um)}</span>
        </div>
        <div class="linha-orc__total"><b>${brl(calc.total)}</b><span>comissão ${brl(calc.comissao)}</span></div>
      </div>
      <span class="mudo" style="font-size:13px">Múltiplos de ${numero(p.emb)} ${esc(p.um)} (embalagem).</span>
      <button class="btn btn--bloco" data-acao="adicionar">${noOrc ? 'Atualizar no orçamento' : 'Adicionar ao orçamento'}</button>
    </div>

    <h3 class="subtitulo">Dados comerciais</h3>
    <dl class="dados">
      <div><dt>Unidade</dt><dd>${esc(p.um)}</dd></div>
      <div><dt>Embalagem</dt><dd>${numero(p.emb)} ${esc(p.um)}</dd></div>
      <div><dt>Peso</dt><dd>${p.peso != null ? numero(p.peso) + ' kg/' + esc(p.um) : '—'}</dd></div>
      <div><dt>NCM</dt><dd>${esc(p.ncm || '—')}</dd></div>
      <div><dt>IPI</dt><dd>${pct(p.ipi / 100)}</dd></div>
      <div><dt>ICMS-ST</dt><dd>${calc.temSt ? 'Sim' : 'Não'}</dd></div>
      <div><dt>Vigência</dt><dd>${dataBR(p.vigencia)}</dd></div>
      <div><dt>Pagamento</dt><dd>28 DD</dd></div>
    </dl>
    ${tecnico}`;
}

function atualizarQtdDetalhe(v) {
  const p = porCodigo.get(estado.detalhe.codigo);
  estado.detalhe.qtd = multiploEmb(v, p.emb);
  renderDetalhe();
}

function adicionar(codigo, k, qtd) {
  const p = porCodigo.get(codigo);
  const i = estado.orc.itens.find((x) => x.codigo === codigo);
  if (i) Object.assign(i, { k, qtd: multiploEmb(qtd, p.emb) });
  else estado.orc.itens.push({ codigo, k, qtd: multiploEmb(qtd, p.emb) });
  salvarOrc();
  renderBadge();
}

function renderBadge() {
  const n = estado.orc.itens.length;
  $('#badge').hidden = !n;
  $('#badge').textContent = n;
}

// ---------- Orçamento ----------
function linhasOrcamento() {
  return estado.orc.itens
    .map((i) => {
      const prod = porCodigo.get(i.codigo);
      if (!prod) return null;
      return { prod, qtd: i.qtd, k: i.k, calc: calcularItem(prod, estado.ds.faixas, i.k, i.qtd, estado.cfg) };
    })
    .filter(Boolean);
}

// Re-renderizar remove o campo focado e dispara "change" no meio do innerHTML;
// tira o foco antes para o evento acontecer fora da troca.
function soltarFoco() {
  const a = document.activeElement;
  if (a?.matches?.('input[type="number"]')) a.blur();
}

function renderOrcamento() {
  soltarFoco();
  $('#cliente').value = estado.orc.cliente || '';
  $('#vendedor').value = estado.orc.vendedor || '';
  const linhas = linhasOrcamento();
  const faixas = estado.ds.faixas;
  const fora = estado.orc.itens.length - linhas.length;
  if (!linhas.length) {
    $('#itens').innerHTML = `<div class="vazio"><b>Orçamento vazio</b>Busque produtos na Consulta e toque em + para adicionar.<br><br><button class="btn btn--contorno" data-ir="consulta">Ir para consulta</button></div>`;
    $('#totais').innerHTML = '';
    return;
  }
  $('#itens').innerHTML = `<div class="orc-grade"><div>${linhas
    .map(
      (x) => `<div class="linha-orc" data-linha="${esc(x.prod.codigo)}">
      <div class="linha-orc__cab">
        <button class="item__abrir" data-abrir="${esc(x.prod.codigo)}">
          <span class="item__cod">${esc(x.prod.codigo)}${x.calc.temSt ? '<span class="tag tag--st">ST</span>' : ''}</span>
          <span class="item__desc">${esc(x.prod.descricao)}</span>
        </button>
        <button class="btn-icone" data-remover="${esc(x.prod.codigo)}" aria-label="Remover ${esc(x.prod.codigo)}">${ICONES.x}</button>
      </div>
      <div class="segmentos" role="group" aria-label="Faixa de desconto">${faixas
        .map((f, k) => `<button data-faixa-item="${k}" aria-pressed="${k === x.k}">${esc(f.nome)}</button>`)
        .join('')}</div>
      <div class="linha-orc__valores">
        <div class="qtd">
          <button class="btn-icone" data-passo="-1" aria-label="Diminuir">${ICONES.menos}</button>
          <input type="number" inputmode="decimal" min="${x.prod.emb}" step="${x.prod.emb}" value="${x.qtd}" data-qtd-item aria-label="Quantidade em ${esc(x.prod.um)}">
          <button class="btn-icone" data-passo="1" aria-label="Aumentar">${ICONES.mais}</button>
          <span class="qtd__un">${esc(x.prod.um)}</span>
        </div>
        <div class="linha-orc__total">
          <b>${brl(x.calc.total)}</b>
          <span>${brl(x.calc.unit)}/${esc(x.prod.um)} + IPI ${brl(x.calc.ipi)}${x.calc.st ? ' + ST ' + brl(x.calc.st) : ''}</span>
        </div>
      </div>
      <span class="comissao">Comissão ${pct(x.calc.comissaoPct)} · ${brl(x.calc.comissao)}</span>
    </div>`
    )
    .join('')}${fora ? `<p class="mudo">${fora} item(ns) não existem mais na tabela atual e foram ocultados.</p>` : ''}</div>
    <div id="caixa-totais"></div></div>`;
  renderTotais(linhas);
}

function renderTotais(linhas = linhasOrcamento()) {
  const t = totalizar(linhas);
  const alvo = $('#caixa-totais') || $('#totais');
  alvo.innerHTML = `<div class="totais">
    <dl>
      <dt>Mercadorias</dt><dd>${brl(t.mercadoria)}</dd>
      <dt>IPI</dt><dd>${brl(t.ipi)}</dd>
      ${t.st ? `<dt>ICMS-ST</dt><dd>${brl(t.st)}</dd>` : ''}
      <div class="total" style="display:contents"><dt>Total</dt><dd>${brl(t.total)}</dd></div>
    </dl>
    <div class="interno"><span class="rotulo">Comissão (não sai no orçamento)</span><br><b>${brl(t.comissao)}</b></div>
    <div class="acoes">
      <button class="btn" data-exportar="texto">Texto</button>
      <button class="btn" data-exportar="imagem">Imagem</button>
      <button class="btn" data-exportar="pdf">PDF</button>
    </div>
    <button class="btn btn--perigo btn--bloco" style="margin-top:8px" data-acao="limpar">Limpar orçamento</button>
  </div>`;
}

async function exportar(tipo) {
  const linhas = linhasOrcamento();
  if (!linhas.length) return;
  const tot = totalizar(linhas);
  const orc = { ...estado.orc, vendedor: estado.orc.vendedor || estado.cfg.vendedor };
  try {
    if (tipo === 'texto') {
      const r = await compartilharTexto(gerarTexto(orc, linhas, tot, estado.ds));
      if (r === 'copiado') aviso('Texto copiado — cole no WhatsApp.');
      return;
    }
    aviso(tipo === 'pdf' ? 'Gerando PDF…' : 'Gerando imagem…');
    const arq = tipo === 'pdf' ? await gerarPdf(orc, linhas, tot, estado.ds) : await gerarImagem(orc, linhas, tot, estado.ds);
    const r = await compartilharArquivo(arq, 'Orçamento Mantac');
    if (r === 'baixado') aviso(`${arq.nome} salvo.`);
  } catch (e) {
    console.error(e);
    aviso('Não foi possível gerar: ' + e.message);
  }
}

// ---------- Painel ----------
function renderPainel() {
  const ds = estado.ds;
  const f = ds.fontes || {};
  const st = estado.cfg.st;
  const ncms = new Map();
  for (const p of ds.produtos) if (p.ncm) ncms.set(p.ncm, (ncms.get(p.ncm) || 0) + 1);
  const pv = estado.previa;
  $('#painel').innerHTML = `
    <div class="cartao">
      <h3>Tabela ativa</h3>
      <p><b>${esc(f.pdf?.lista || 'Tabela 44')}</b><br>
      Data de referência ${dataBR(f.pdf?.dataRef)} · ${ds.produtos.length} produtos · ${ds.origem === 'upload' ? 'importada neste aparelho' : 'versão publicada no app'}</p>
      <p class="mudo" style="font-size:14px">
        PDF: ${esc(f.pdf?.arquivo || '—')} (${dataBR(f.pdf?.em)})<br>
        Planilha: ${esc(f.xls?.arquivo || '—')} (${dataBR(f.xls?.em)})<br>
        Faixas: ${ds.faixas.map((x) => `${esc(x.nome)} (comissão ${pct(x.comissao)})`).join(' · ')}
      </p>
      ${ds.origem === 'upload' ? '<button class="btn btn--contorno" data-acao="restaurar">Voltar à versão publicada</button>' : ''}
    </div>

    <div class="cartao">
      <h3>Atualizar tabela</h3>
      <p>Envie a <b>Lista de Preços de Venda (PDF do Prosyst)</b> e/ou a <b>planilha de descontos (XLS/XLSX)</b>. O PDF substitui a lista de produtos; a planilha atualiza preços, faixas, comissões e preços especiais.</p>
      <label class="upload" id="upload">
        <input type="file" id="arquivo" accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        <b class="rotulo" style="color:var(--azul)">Escolher arquivo</b>
        <span class="mudo" style="font-size:14px">PDF, XLS ou XLSX</span>
      </label>
      ${pv ? `<div class="previa">
        <b>${esc(pv.arquivo)}</b>
        <ul>
          <li>${pv.resumo.total} produtos após a importação</li>
          <li>${pv.resumo.novos} novos · ${pv.resumo.removidos} removidos</li>
          <li>${pv.resumo.precoAlterado} com preço alterado</li>
          ${pv.extra ? `<li>${esc(pv.extra)}</li>` : ''}
        </ul>
        <div class="botoes"><button class="btn" data-acao="confirmar">Aplicar</button><button class="btn btn--contorno" data-acao="descartar">Cancelar</button></div>
      </div>` : ''}
    </div>

    <div class="cartao">
      <h3>ICMS-ST (clientes do PR)</h3>
      <p>Preencha a MVA dos NCMs sujeitos a ST. NCM em branco = sem ST.</p>
      <div class="grade2" style="margin-bottom:16px">
        <label class="campo"><span>ICMS interno PR (%)</span><input type="number" step="0.01" data-st="aliqInterna" value="${st.aliqInterna}"></label>
        <label class="campo"><span>ICMS interestadual (%)</span><input type="number" step="0.01" data-st="aliqInter" value="${st.aliqInter}"></label>
      </div>
      <table class="tabela-ncm">
        <thead><tr><th>NCM</th><th>Itens</th><th style="text-align:right">MVA %</th></tr></thead>
        <tbody>${[...ncms.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([n, q]) => `<tr><td>${esc(n)}</td><td>${q}</td><td style="text-align:right"><input type="number" step="0.01" inputmode="decimal" data-mva="${esc(n)}" value="${st.ncms[n]?.mva ?? ''}" placeholder="—" aria-label="MVA do NCM ${esc(n)}"></td></tr>`)
          .join('')}</tbody>
      </table>
      <label class="campo" style="margin-top:16px"><span>Códigos sem ST (exceções)</span>
        <textarea data-semst placeholder="Ex.: 9700, 9701">${esc((st.semSt || []).join(', '))}</textarea>
        <small>Separados por vírgula ou espaço. Ficam fora da ST mesmo com o NCM configurado.</small>
      </label>
      <p class="mudo" style="font-size:13px;margin-top:12px">ST = (mercadoria + IPI) × (1 + MVA) × ICMS interno − mercadoria × ICMS interestadual.</p>
    </div>

    <div class="cartao">
      <h3>Vendedor padrão</h3>
      <label class="campo"><span>Nome</span><input type="text" data-cfg="vendedor" value="${esc(estado.cfg.vendedor)}"></label>
    </div>
    <p class="mudo" style="font-size:13px">Mantac Pedidos · dados salvos só neste aparelho · funciona offline.</p>`;
}

async function lerArquivo(file) {
  const nome = file.name;
  const ext = nome.split('.').pop().toLowerCase();
  aviso('Lendo ' + nome + '…');
  try {
    const { lerPdf, lerXls } = await import('./importar.js');
    let novo, extra = '';
    if (ext === 'pdf') {
      const r = await lerPdf(file);
      novo = aplicarPdf(estado.ds, r, nome);
      extra = r.lista ? `Lista: ${r.lista} · ref. ${dataBR(r.dataRef)}` : '';
      if (r.lista && !/^44\b/.test(r.lista)) extra += ' — atenção: não parece ser a Tabela 44';
    } else if (ext === 'xls' || ext === 'xlsx') {
      const r = await lerXls(file);
      novo = aplicarXls(estado.ds, r, nome);
      const exc = r.produtos.filter((p) => Object.keys(p.excecoes).length).length;
      extra = `Faixas: ${novo.faixas.map((f) => `${f.nome} ${pct(f.comissao)}`).join(' · ')} · ${exc} preços especiais`;
    } else throw new Error('Formato não suportado (use PDF, XLS ou XLSX).');
    novo.origem = 'upload';
    estado.previa = { arquivo: nome, ds: novo, resumo: comparar(estado.ds, novo), extra };
  } catch (e) {
    console.error(e);
    aviso('Erro: ' + e.message);
  }
  renderPainel();
}

// ---------- Eventos ----------
function ligarEventos() {
  let t;
  $('#busca').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      estado.busca = e.target.value;
      estado.limite = 60;
      renderResultados();
    }, 120);
  });
  $('#mais').addEventListener('click', () => {
    estado.limite += 60;
    renderResultados();
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-ir],[data-classe],[data-abrir],[data-rapido],[data-acao],[data-faixa],[data-qtd],[data-remover],[data-faixa-item],[data-passo],[data-exportar]');
    if (!el) return;
    const ds = el.dataset;
    if (ds.ir) return irPara(ds.ir);
    if (ds.classe !== undefined) {
      estado.classe = ds.classe;
      estado.limite = 60;
      renderClasses();
      renderResultados();
      return;
    }
    if (ds.abrir) return abrirDetalhe(ds.abrir);
    if (ds.rapido) {
      const p = porCodigo.get(ds.rapido);
      const ja = estado.orc.itens.find((i) => i.codigo === p.codigo);
      adicionar(p.codigo, ja?.k ?? 0, (ja?.qtd ?? 0) + p.emb);
      const q = estado.orc.itens.find((i) => i.codigo === p.codigo).qtd;
      return aviso(`${p.codigo} · ${numero(q)} ${p.um} no orçamento`);
    }
    if (ds.faixa !== undefined) {
      estado.detalhe.k = Number(ds.faixa);
      return renderDetalhe();
    }
    if (ds.qtd) {
      const p = porCodigo.get(estado.detalhe.codigo);
      return atualizarQtdDetalhe(Math.max(p.emb, estado.detalhe.qtd + Number(ds.qtd) * p.emb));
    }
    const linha = el.closest('[data-linha]');
    if (ds.remover) {
      estado.orc.itens = estado.orc.itens.filter((i) => i.codigo !== ds.remover);
      salvarOrc();
      renderBadge();
      return renderOrcamento();
    }
    if (linha && (ds.faixaItem !== undefined || ds.passo)) {
      const it = estado.orc.itens.find((i) => i.codigo === linha.dataset.linha);
      const p = porCodigo.get(it.codigo);
      if (ds.faixaItem !== undefined) it.k = Number(ds.faixaItem);
      else it.qtd = Math.max(p.emb, it.qtd + Number(ds.passo) * p.emb);
      salvarOrc();
      return renderOrcamento();
    }
    if (ds.exportar) return exportar(ds.exportar);
    switch (ds.acao) {
      case 'fechar':
        return fecharDetalhe();
      case 'adicionar': {
        const d = estado.detalhe;
        const v = $('#det-qtd').value;
        adicionar(d.codigo, d.k, v);
        fecharDetalhe();
        return aviso('Adicionado ao orçamento');
      }
      case 'limpar':
        if (!confirm('Limpar todos os itens do orçamento?')) return;
        estado.orc = { cliente: '', vendedor: estado.cfg.vendedor, itens: [] };
        salvarOrc();
        renderBadge();
        return renderOrcamento();
      case 'confirmar':
        estado.ds = estado.previa.ds;
        estado.previa = null;
        db.gravar('ds', estado.ds);
        indexar();
        renderTudo();
        renderPainel();
        return aviso('Tabela atualizada');
      case 'descartar':
        estado.previa = null;
        return renderPainel();
      case 'restaurar':
        if (!confirm('Descartar as importações feitas neste aparelho e voltar à tabela publicada?')) return;
        return carregarEmbutido().then(async (ds) => {
          estado.ds = ds;
          await db.apagar('ds');
          indexar();
          renderTudo();
          renderPainel();
          aviso('Tabela publicada restaurada');
        });
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'det-qtd') return atualizarQtdDetalhe(el.value);
    if (el.matches('[data-qtd-item]')) {
      const it = estado.orc.itens.find((i) => i.codigo === el.closest('[data-linha]').dataset.linha);
      const p = porCodigo.get(it.codigo);
      const q = multiploEmb(el.value, p.emb);
      if (q !== Number(el.value)) aviso(`Ajustado para ${numero(q)} ${p.um} (múltiplo de ${numero(p.emb)})`);
      it.qtd = q;
      salvarOrc();
      return renderOrcamento();
    }
    if (el.id === 'arquivo' && el.files[0]) return lerArquivo(el.files[0]);
    const st = estado.cfg.st;
    if (el.dataset.st) st[el.dataset.st] = Number(el.value) || 0;
    else if (el.dataset.mva !== undefined) {
      if (el.value === '') delete st.ncms[el.dataset.mva];
      else st.ncms[el.dataset.mva] = { mva: Number(el.value) };
    } else if (el.dataset.semst !== undefined) st.semSt = el.value.split(/[\s,;]+/).filter(Boolean);
    else if (el.dataset.cfg === 'vendedor') {
      estado.cfg.vendedor = el.value.trim();
      if (!estado.orc.itens.length) estado.orc.vendedor = estado.cfg.vendedor;
    } else return;
    salvarCfg();
    renderResultados();
    aviso('Configuração salva');
  });

  $('#cliente').addEventListener('input', (e) => {
    estado.orc.cliente = e.target.value;
    salvarOrc();
  });
  $('#vendedor').addEventListener('input', (e) => {
    estado.orc.vendedor = e.target.value;
    salvarOrc();
  });

  // Arrastar arquivo no painel.
  document.addEventListener('dragover', (e) => {
    const up = e.target.closest?.('#upload');
    if (up) {
      e.preventDefault();
      up.classList.add('arrastando');
    }
  });
  document.addEventListener('dragleave', (e) => e.target.closest?.('#upload')?.classList.remove('arrastando'));
  document.addEventListener('drop', (e) => {
    const up = e.target.closest?.('#upload');
    if (!up) return;
    e.preventDefault();
    up.classList.remove('arrastando');
    if (e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#folha').hidden) fecharDetalhe();
  });
  window.addEventListener('hashchange', () => irPara(location.hash.slice(1), false));
}

iniciar();
