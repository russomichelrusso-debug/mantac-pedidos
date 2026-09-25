import * as db from './db.js';
import * as api from './api.js';
import { CONFIG_PADRAO, CONDICOES_PADRAO, calcularItem, totalizar, multiploEmb, situacaoSt, regraSt, ofertaVigente, precoOferta, brl, numero, pct } from './precos.js';
import { aplicarPdf, aplicarXls, comparar } from './dados.js';
import { gerarTexto, gerarImagem, gerarPdf, compartilharArquivo, compartilharTexto } from './compartilhar.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[”“″]/g, '"').replace(/½/g, '1/2');
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const dataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function formatarDoc(v) {
  const d = soDigitos(v);
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  return String(v ?? '').trim();
}

const ICONES = {
  mais: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  menos: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  voltar: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  trocar: '<svg viewBox="0 0 24 24"><path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"/></svg>',
  lixo: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  editar: '<svg viewBox="0 0 24 24"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
};

const orcVazio = (cfg) => ({ id: null, numero: null, clienteId: null, cliente: '', clienteDoc: '', clienteCodigo: '', vendedor: cfg.vendedor, faixaPadrao: 0, condicao: '28dd', recolheSt: false, itens: [] });

const estado = {
  ds: null,
  st: null, // tabela de ICMS-ST por código ({ arquivo, porCodigo, origem })
  ofertas: null, // { nome, inicio, validade, comissao, precos: {codigo: preço}, origem }
  soOfertas: false,
  cat: { linhas: [], itens: {} },
  cfg: structuredClone(CONFIG_PADRAO),
  orc: null,
  clientes: [],
  historico: [],
  seq: 0,
  busca: '',
  limite: 30,
  pend: {}, // quantidade escolhida no card antes de adicionar
  previa: null,
  fila: [], // alterações ainda não enviadas ao servidor: { rec, id, dados|null }
  ultimoSync: null,
  erroSync: '',
  usuarios: null, // lista (admin)
  previaPedidos: null,
  vista: 'pedido',
};
let indice = [];
// Configuração de cálculo: preferências salvas + tabela de ST por código.
const ofertasAtivas = () => (ofertaVigente(estado.ofertas) ? estado.ofertas : null);
const condicoes = () => (estado.cfg.condicoes?.length ? estado.cfg.condicoes : CONDICOES_PADRAO);
const condicaoAtual = (orc = estado.orc) => condicoes().find((c) => c.id === orc?.condicao) || condicoes()[0];
const nomeCondicao = (c) => (c.desconto ? `${c.nome} (−${String(c.desconto).replace('.', ',')}%)` : c.nome);
const ctx = () => ({
  ...estado.cfg,
  tabelaSt: estado.st,
  ofertas: ofertasAtivas(),
  descPagamento: condicaoAtual().desconto || 0,
  clienteRecolheSt: !!estado.orc?.recolheSt,
});
const dataCurta = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '');
let porCodigo = new Map();

// ---------- Carga ----------
async function iniciar() {
  const chaves = ['cfg', 'orc', 'ds', 'clientes', 'historico', 'seq', 'st', 'ofertas', 'fila'];
  const [cfg, orc, ds, clientes, historico, seq, st, ofertas, fila] = await Promise.all(chaves.map((k) => db.ler(k).catch(() => undefined)));
  if (cfg) estado.cfg = { ...structuredClone(CONFIG_PADRAO), ...cfg, st: { ...CONFIG_PADRAO.st, ...cfg.st } };
  estado.orc = { ...orcVazio(estado.cfg), ...(orc || {}) };
  if (estado.orc.aVista) estado.orc.condicao = 'avista';
  delete estado.orc.aVista;
  estado.clientes = clientes || [];
  estado.historico = historico || [];
  estado.seq = seq || 0;
  estado.fila = fila || [];
  // Tabela, ST e ofertas vêm do servidor (cópia local para funcionar offline).
  estado.ds = ds?.produtos ? ds : null;
  estado.st = st || null;
  estado.ofertas = ofertas || null;
  try {
    estado.cat = await (await fetch('data/catalogo.json')).json();
  } catch { /* catálogo técnico é opcional */ }
  ligarEventos();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!api.token()) return mostrarLogin();
  await abrirApp();
}

let appAberto = false;
async function abrirApp() {
  esconderLogin();
  if (!estado.ds) {
    mostrarCarregando('Baixando a tabela de preços…');
    await sincronizar();
    if (!estado.ds) return mostrarLogin(estado.erroSync || 'Não foi possível baixar a tabela. É preciso internet no primeiro acesso.', true);
    esconderLogin();
  }
  indexar();
  renderTopo();
  irPara(location.hash.slice(1) || 'pedido', false);
  if (!appAberto) {
    appAberto = true;
    setInterval(sincronizar, 60000);
    window.addEventListener('online', sincronizar);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sincronizar());
  }
  sincronizar();
}

// ---------- Login ----------
function mostrarCarregando(msg) {
  $('#login').hidden = false;
  $('#login-msg').textContent = msg;
  $('#login-msg').className = 'login__msg';
  $('#login-google').hidden = true;
  $('#login-tentar').hidden = true;
}

function mostrarLogin(msg = '', soTentarDeNovo = false) {
  $('#login').hidden = false;
  $('#login-msg').textContent = msg;
  $('#login-msg').className = 'login__msg' + (msg ? ' login__msg--erro' : '');
  $('#login-tentar').hidden = !soTentarDeNovo;
  $('#login-google').hidden = soTentarDeNovo;
  if (soTentarDeNovo) return;
  api
    .botaoGoogle(
      $('#login-google'),
      async (u) => {
        estado.cfg.vendedor = u.vendedor || estado.cfg.vendedor;
        salvarCfgLocal();
        await abrirApp();
        aviso(`Bem-vindo, ${u.nome || u.email}`);
      },
      (e) => {
        $('#login-msg').textContent = e.message;
        $('#login-msg').className = 'login__msg login__msg--erro';
      }
    )
    .catch((e) => {
      $('#login-msg').textContent = (msg ? msg + ' ' : '') + e.message;
      $('#login-msg').className = 'login__msg login__msg--erro';
      $('#login-tentar').hidden = false;
    });
}

function esconderLogin() {
  $('#login').hidden = true;
}

// ---------- Sincronização ----------
function aplicarDado(chave, valor) {
  if (!valor) return;
  if (chave === 'tabela44') {
    estado.ds = { ...valor, origem: 'servidor' };
    db.gravar('ds', estado.ds).catch(() => {});
    if (appAberto) indexar();
  } else if (chave === 'st') {
    estado.st = { ...valor, origem: 'servidor' };
    db.gravar('st', estado.st).catch(() => {});
  } else if (chave === 'ofertas') {
    estado.ofertas = { ...valor, origem: 'servidor' };
    db.gravar('ofertas', estado.ofertas).catch(() => {});
  } else if (chave === 'config') {
    if (valor.condicoes) estado.cfg.condicoes = valor.condicoes;
    if (valor.st) estado.cfg.st = { ...CONFIG_PADRAO.st, ...valor.st };
    salvarCfgLocal();
  }
}

function enfileirar(rec, id, dados, enviar = true) {
  estado.fila = estado.fila.filter((f) => !(f.rec === rec && f.id === id));
  estado.fila.push({ rec, id, dados: dados ? structuredClone(dados) : null });
  db.gravar('fila', estado.fila).catch(() => {});
  if (enviar) enviarFila();
}

let enviando = null;
function enviarFila() {
  if (enviando) return enviando;
  enviando = (async () => {
    while (estado.fila.length && api.token()) {
      const f = estado.fila[0];
      try {
        const caminho = `/${f.rec}/${encodeURIComponent(f.id)}`;
        if (f.dados) await api.chamar('PUT', caminho, { dados: f.dados });
        else await api.chamar('DELETE', caminho);
      } catch (e) {
        if (e instanceof api.ErroRede) break;
        if (e instanceof api.ErroSessao) {
          sessaoExpirada(e.message);
          break;
        }
        console.error(e);
        aviso('Não foi possível enviar uma alteração: ' + e.message);
      }
      estado.fila = estado.fila.filter((x) => x !== f);
      await db.gravar('fila', estado.fila).catch(() => {});
    }
  })().finally(() => {
    enviando = null;
    if (estado.vista === 'painel') renderStatusSync();
  });
  return enviando;
}

function sessaoExpirada(msg) {
  api.guardarSessao(null, null);
  mostrarLogin(msg);
}

let sincronizando = false;
async function sincronizar() {
  if (sincronizando || !api.token()) return;
  sincronizando = true;
  try {
    await enviarFila();
    const desde = await db.ler('syncDesde').catch(() => null);
    const r = await api.chamar('GET', '/sync' + (desde ? `?desde=${encodeURIComponent(desde)}` : ''), null, { timeout: 45000 });
    const pendentes = new Set(estado.fila.map((f) => f.rec + ':' + f.id));
    let mudou = false;
    for (const rec of ['clientes', 'historico']) {
      for (const x of r[rec]) {
        if (pendentes.has(rec + ':' + x.id)) continue; // alteração local ainda não enviada vence
        const lista = estado[rec];
        const i = lista.findIndex((e) => e.id === x.id);
        if (x.excluido) {
          if (i >= 0) lista.splice(i, 1);
        } else if (i >= 0) lista[i] = x.dados;
        else lista.push(x.dados);
        mudou = true;
      }
    }
    if (!desde) {
      // Primeira sincronização neste aparelho: envia o que só existe aqui.
      for (const rec of ['clientes', 'historico']) {
        const noServidor = new Set(r[rec].map((x) => x.id));
        for (const x of estado[rec]) if (!noServidor.has(x.id)) enfileirar(rec, x.id, x, false);
      }
      if (!r.dados.some((d) => d.chave === 'config') && api.usuario()?.is_admin && estado.cfg.st) enviarConfig();
    }
    for (const d of r.dados) aplicarDado(d.chave, d.valor);
    if (mudou) await Promise.all([salvarClientes(), salvarHistorico()]);
    await db.gravar('syncDesde', new Date(new Date(r.agora).getTime() - 10000).toISOString());
    estado.ultimoSync = new Date().toISOString();
    estado.erroSync = '';
    if (estado.fila.length) await enviarFila();
    if (appAberto && (mudou || r.dados.length)) {
      renderTopo();
      if (!$('#folha').hidden && $('#folha').dataset.tipo === 'orc') renderOrcamento();
      else if (estado.vista === 'pedido') renderPedido();
      else if (estado.vista === 'clientes') renderClientes();
      else if (estado.vista === 'historico') renderHistorico();
      renderBarra();
    }
  } catch (e) {
    estado.erroSync = e.message;
    if (e instanceof api.ErroSessao) sessaoExpirada(e.message);
  } finally {
    sincronizando = false;
    if (estado.vista === 'painel') renderStatusSync();
  }
}

let tConfig;
function enviarConfig() {
  clearTimeout(tConfig);
  tConfig = setTimeout(() => {
    api.chamar('PUT', '/dados/config', { valor: { condicoes: estado.cfg.condicoes, st: estado.cfg.st } }).catch((e) => aviso('Configuração não enviada ao servidor: ' + e.message));
  }, 800);
}

async function proximoNumero() {
  try {
    return (await api.chamar('POST', '/historico/numero')).numero;
  } catch {
    // Sem conexão: número provisório local (L = local).
    estado.seq += 1;
    db.gravar('seq', estado.seq).catch(() => {});
    return `L${estado.seq}`;
  }
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
const salvarCfgLocal = () => db.gravar('cfg', estado.cfg).catch(() => {});
// Preferências compartilhadas (condições, ST) vão para o servidor; vendedor fica no aparelho/usuário.
const salvarCfg = () => {
  salvarCfgLocal();
  enviarConfig();
};
const salvarClientes = () => db.gravar('clientes', estado.clientes).catch(() => {});
const salvarHistorico = () => db.gravar('historico', estado.historico).catch(() => {});

function aviso(msg) {
  const el = $('#aviso');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => el.classList.remove('on'), 2600);
}

// ---------- Modal de confirmação ----------
function confirmar(msg, rotulo = 'Confirmar', perigo = false) {
  return new Promise((ok) => {
    abrirModal(`<p class="modal__msg">${esc(msg)}</p>
      <div class="botoes botoes--fim">
        <button class="btn btn--contorno" data-resp="0">Cancelar</button>
        <button class="btn ${perigo ? 'btn--perigo-cheio' : ''}" data-resp="1">${esc(rotulo)}</button>
      </div>`);
    $('#modal-corpo').addEventListener('click', function h(e) {
      const b = e.target.closest('[data-resp]');
      if (!b) return;
      $('#modal-corpo').removeEventListener('click', h);
      fecharModal();
      ok(b.dataset.resp === '1');
    });
  });
}

function abrirModal(html) {
  $('#modal-corpo').innerHTML = html;
  $('#modal').hidden = false;
  $('#modal-corpo').focus();
}
function fecharModal() {
  $('#modal').hidden = true;
  $('#modal-corpo').innerHTML = '';
}

function abrirFolha(html) {
  $('#folha-corpo').innerHTML = html;
  $('#folha').hidden = false;
  document.body.style.overflow = 'hidden';
  $('#folha-corpo').scrollTop = 0;
  $('#folha-corpo').focus();
}
function fecharFolha() {
  $('#folha').hidden = true;
  $('#folha').dataset.tipo = '';
  document.body.style.overflow = '';
}

// Re-renderizar remove o campo focado e dispara "change" no meio do innerHTML;
// tira o foco antes para o evento acontecer fora da troca.
function soltarFoco() {
  const a = document.activeElement;
  if (a?.matches?.('input[type="number"]')) a.blur();
}

// ---------- Navegação ----------
const VISTAS = ['pedido', 'clientes', 'historico', 'painel'];
function irPara(vista, push = true) {
  if (!VISTAS.includes(vista)) vista = 'pedido';
  estado.vista = vista;
  document.querySelectorAll('.vista').forEach((v) => (v.hidden = v.dataset.vista !== vista));
  document.querySelectorAll('[data-ir]').forEach((b) => (b.dataset.ir === vista ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (push) history.replaceState(null, '', '#' + vista);
  if (vista === 'pedido') renderPedido();
  if (vista === 'clientes') renderClientes();
  if (vista === 'historico') renderHistorico();
  if (vista === 'painel') renderPainel();
  renderBarra();
  window.scrollTo(0, 0);
}

function renderTopo() {
  const f = estado.ds.fontes?.pdf;
  $('#topo-info').textContent = `${f?.lista ? 'Tabela ' + f.lista.split(' - ')[0] : 'Tabela 44'} · ${dataBR(f?.dataRef)}`;
}

// ---------- Pedido ----------
function clienteAtual() {
  return estado.clientes.find((c) => c.id === estado.orc.clienteId) || null;
}

function renderClienteCard() {
  const c = clienteAtual();
  const nome = c?.nome || estado.orc.cliente;
  if (!nome) {
    $('#cliente-card').innerHTML = `<button class="cliente-vazio" data-acao="escolher-cliente">＋ Selecionar cliente</button>`;
    return;
  }
  const qtdOrc = c ? estado.historico.filter((h) => h.clienteId === c.id).length : 0;
  $('#cliente-card').innerHTML = `<div class="cliente-card">
      <div class="cliente-card__info">
        <span class="rotulo">Cliente</span>
        <b class="cliente-card__nome">${esc(nome)}</b>
        <span class="mudo">${c?.codigoErp ? `Cód. ${esc(c.codigoErp)} · ` : ''}${esc(formatarDoc(c?.doc || estado.orc.clienteDoc) || 'Sem CNPJ')}${c?.cidade ? ' · ' + esc(c.cidade) : ''}${c?.recolheSt ? ' · recolhe ST' : ''}</span>
        ${qtdOrc ? `<button class="link" data-historico-cliente="${esc(c.id)}">${qtdOrc} orçamento${qtdOrc > 1 ? 's' : ''} anterior${qtdOrc > 1 ? 'es' : ''}</button>` : ''}
      </div>
      <button class="btn-icone" data-acao="escolher-cliente" aria-label="Trocar cliente">${ICONES.trocar}</button>
    </div>`;
}

function renderFaixaPadrao() {
  $('#faixa-padrao').innerHTML = estado.ds.faixas
    .map((f, k) => `<button data-faixa-padrao="${k}" aria-pressed="${k === estado.orc.faixaPadrao}">${esc(f.nome)}<small>com. ${pct(f.comissao)}</small></button>`)
    .join('');
}

function renderOfertasChip() {
  const o = ofertasAtivas();
  const el = $('#ofertas-chip');
  el.hidden = !o;
  if (!o) {
    estado.soOfertas = false;
    return;
  }
  const n = estado.ds.produtos.filter((p) => precoOferta(p, ctx())).length;
  el.setAttribute('aria-pressed', estado.soOfertas);
  el.innerHTML = `<b>${esc(o.nome || 'Ofertas')}</b> · ${n} produtos · até ${dataCurta(o.validade)}`;
}

function renderPedido() {
  $('#busca').value = estado.busca;
  renderClienteCard();
  renderFaixaPadrao();
  renderOfertasChip();
  renderResultados();
}

function filtrar() {
  const termos = norm(estado.busca).split(/\s+/).filter(Boolean);
  const c = ctx();
  let r = indice.filter((x) => (!estado.soOfertas || precoOferta(x.p, c)) && termos.every((t) => x.chave.includes(t)));
  if (termos.length === 1) {
    const t = termos[0];
    const cod = (x) => norm(x.p.codigo);
    r = [...r.filter((x) => cod(x) === t), ...r.filter((x) => cod(x) !== t && cod(x).startsWith(t)), ...r.filter((x) => !cod(x).startsWith(t))];
  }
  return r.map((x) => x.p);
}

const qtdPendente = (p) => estado.pend[p.codigo] ?? p.emb;

function cardProduto(p) {
  const k = estado.orc.faixaPadrao;
  const f = estado.ds.faixas[k];
  const c = calcularItem(p, estado.ds.faixas, k, 1, ctx());
  const tabela = { unit: p.preco };
  const noOrc = estado.orc.itens.find((i) => i.codigo === p.codigo);
  const tec = estado.cat.itens?.[p.codigo];
  return `<div class="card" data-card="${esc(p.codigo)}">
    <div class="card__topo">
      <span class="selo">${esc(p.classe || p.tipo || 'Produto')}</span>
      ${c.emOferta ? `<span class="selo selo--oferta">Oferta até ${dataCurta(ofertasAtivas().validade)}</span>` : ''}
      ${c.temSt ? '<span class="selo selo--st">ST</span>' : ''}
      ${noOrc ? `<span class="selo selo--ok">No orçamento · ${numero(noOrc.qtd)} ${esc(p.um)}</span>` : ''}
    </div>
    <button class="card__nome" data-abrir="${esc(p.codigo)}">${esc(p.descricao)}${tec ? `<span class="info" aria-label="Ficha técnica">${ICONES.info}</span>` : ''}</button>
    <div class="card__sub">Cód. ${esc(p.codigo)} · Emb. ${numero(p.emb)} ${esc(p.um)} · IPI ${pct(p.ipi / 100)}</div>
    <div class="card__rodape">
      <div class="qtd qtd--mini">
        <button class="btn-icone" data-pend="${esc(p.codigo)}" data-d="-1" aria-label="Diminuir">${ICONES.menos}</button>
        <input type="number" inputmode="decimal" min="${p.emb}" step="${p.emb}" value="${qtdPendente(p)}" data-pend-input="${esc(p.codigo)}" aria-label="Quantidade em ${esc(p.um)}">
        <button class="btn-icone" data-pend="${esc(p.codigo)}" data-d="1" aria-label="Aumentar">${ICONES.mais}</button>
      </div>
      <div class="card__preco">
        ${c.unit < tabela.unit - 0.004 ? `<span class="de">tabela <s>${brl(tabela.unit)}</s></span>` : ''}
        <b>${brl(c.unit)}<small>/${esc(p.um)}</small></b>
        <span>c/ imp. ${brl(c.unitFinal)} · ${esc(f.nome)}</span>
      </div>
      <button class="btn-add" data-add="${esc(p.codigo)}" aria-label="Adicionar ${esc(p.codigo)} ao orçamento">${ICONES.mais}</button>
    </div>
  </div>`;
}

function renderResultados() {
  const q = estado.busca.trim();
  if (q.length < 2 && !estado.soOfertas) {
    $('#contagem').textContent = 'Digite ao menos 2 caracteres para buscar.';
    $('#resultados').innerHTML = '';
    $('#mais').hidden = true;
    return;
  }
  const r = filtrar();
  $('#contagem').textContent = `${r.length} produto${r.length === 1 ? '' : 's'} ${estado.soOfertas ? 'em oferta' : 'encontrado' + (r.length === 1 ? '' : 's')}`;
  $('#resultados').innerHTML = r.length
    ? r.slice(0, estado.limite).map(cardProduto).join('')
    : `<div class="vazio"><b>Nada encontrado</b>Nenhum produto para “${esc(q)}”.</div>`;
  $('#mais').hidden = r.length <= estado.limite;
}

function atualizarCard(codigo) {
  const el = document.querySelector(`[data-card="${CSS.escape(codigo)}"]`);
  if (el) el.outerHTML = cardProduto(porCodigo.get(codigo));
}

function adicionar(codigo, qtd, k) {
  const p = porCodigo.get(codigo);
  const q = multiploEmb(qtd, p.emb);
  const it = estado.orc.itens.find((i) => i.codigo === codigo);
  if (it) {
    it.qtd += q;
    if (k != null) it.k = k;
  } else estado.orc.itens.push({ codigo, qtd: q, k: k ?? estado.orc.faixaPadrao });
  salvarOrc();
  renderBarra();
  return estado.orc.itens.find((i) => i.codigo === codigo);
}

// ---------- Barra e gaveta do orçamento ----------
function linhasOrcamento(orc = estado.orc) {
  return orc.itens
    .map((i) => {
      const prod = porCodigo.get(i.codigo);
      if (!prod) return null;
      return { prod, qtd: i.qtd, k: i.k, calc: calcularItem(prod, estado.ds.faixas, i.k, i.qtd, ctx()) };
    })
    .filter(Boolean);
}

function renderBarra() {
  const n = estado.orc.itens.length;
  const barra = $('#barra-orc');
  barra.hidden = !n || estado.vista === 'painel';
  document.body.classList.toggle('com-barra', !barra.hidden);
  if (!n) return;
  $('#barra-n').textContent = n;
  $('#barra-total').textContent = brl(totalizar(linhasOrcamento()).total) + ' ▸';
}

function abrirOrcamento() {
  $('#folha').dataset.tipo = 'orc';
  abrirFolha('');
  renderOrcamento();
}

function renderOrcamento() {
  if ($('#folha').dataset.tipo !== 'orc') return;
  soltarFoco();
  const linhas = linhasOrcamento();
  const t = totalizar(linhas);
  const faixas = estado.ds.faixas;
  const o = estado.orc;
  $('#folha-corpo').innerHTML = `
    <div class="folha__barra">
      <div><h2 class="folha__titulo">Orçamento${o.numero ? ' nº ' + o.numero : ''}</h2>
      <span class="mudo">${linhas.length} ite${linhas.length === 1 ? 'm' : 'ns'}${o.cliente ? ' · ' + esc(o.cliente) : ''}</span></div>
      <div class="botoes-barra">
        ${linhas.length ? `<button class="btn btn--perigo btn--mini" data-acao="limpar-orc">${ICONES.lixo} Limpar</button>` : ''}
        <button class="btn-icone" data-acao="fechar" aria-label="Fechar">${ICONES.x}</button>
      </div>
    </div>
    ${linhas.length ? '' : '<div class="vazio"><b>Nenhum item</b>Busque produtos e toque em + para adicionar.</div>'}
    ${linhas
      .map(
        (x, i) => `<div class="linha-orc" data-linha="${esc(x.prod.codigo)}">
      <div class="linha-orc__cab">
        <span class="num">${i + 1}</span>
        <button class="item__abrir" data-abrir="${esc(x.prod.codigo)}">
          <span class="item__desc">${esc(x.prod.descricao)}</span>
          <span class="item__meta">Cód. ${esc(x.prod.codigo)} · múltiplos de ${numero(x.prod.emb)} ${esc(x.prod.um)}${x.calc.emOferta ? ' · <b class="of">OFERTA</b>' : ''}${x.calc.temSt ? ' · <b class="st">ST</b>' : ''}${x.calc.stDoCliente ? ' · ST pelo cliente' : ''}</span>
        </button>
        <button class="btn-icone btn-icone--sem-borda" data-remover="${esc(x.prod.codigo)}" aria-label="Remover ${esc(x.prod.codigo)}">${ICONES.x}</button>
      </div>
      <div class="segmentos" role="group" aria-label="Faixa de desconto">${faixas
        .map((f, k) => `<button data-faixa-item="${k}" aria-pressed="${k === x.k}">${esc(f.nome)}</button>`)
        .join('')}</div>
      <div class="linha-orc__valores">
        <div class="qtd qtd--mini">
          <button class="btn-icone" data-passo="-1" aria-label="Diminuir">${ICONES.menos}</button>
          <input type="number" inputmode="decimal" min="${x.prod.emb}" step="${x.prod.emb}" value="${x.qtd}" data-qtd-item aria-label="Quantidade em ${esc(x.prod.um)}">
          <button class="btn-icone" data-passo="1" aria-label="Aumentar">${ICONES.mais}</button>
          <span class="qtd__un">${esc(x.prod.um)}</span>
        </div>
        <div class="linha-orc__total">
          <b>${brl(x.calc.total)}</b>
          <span>${brl(x.calc.unit)}/${esc(x.prod.um)} + IPI${x.calc.st ? ' + ST' : ''}</span>
          <span class="comissao">com. ${pct(x.calc.comissaoPct)} · ${brl(x.calc.comissao)}${x.prod.peso ? ` · P.M. ${brl(x.calc.unit / x.prod.peso)}` : ''}</span>
        </div>
      </div>
    </div>`
      )
      .join('')}
    ${linhas.length ? `<div class="campo" style="margin-top:24px"><span>Condição de pagamento</span>
      <div class="segmentos segmentos--${condicoes().length}" role="group" aria-label="Condição de pagamento">${condicoes()
        .map((c) => `<button data-condicao="${esc(c.id)}" aria-pressed="${c.id === condicaoAtual().id}">${esc(c.nome)}${c.desconto ? `<small>−${String(c.desconto).replace('.', ',')}%</small>` : '<small>sem desc.</small>'}</button>`)
        .join('')}</div></div>
      <label class="check check--caixa"><input type="checkbox" data-recolhe-st ${o.recolheSt ? 'checked' : ''}> <span><b>Cliente recolhe a ST</b><br><small class="mudo">Não cobra ICMS-ST no orçamento (como no pedido oficial “cliente recolhe a ST”).</small></span></label>` : ''}
    ${linhas.length ? `<div class="totais">
      <dl>
        <dt>Total s/ impostos</dt><dd>${brl(t.mercadoria)}</dd>
        <dt>IPI</dt><dd>${brl(t.ipi)}</dd>
        ${t.st ? `<dt>ICMS-ST</dt><dd>${brl(t.st)}</dd>` : ''}
        <div class="total" style="display:contents"><dt>Total</dt><dd>${brl(t.total)}</dd></div>
      </dl>
      <div class="interno"><span class="rotulo">Comissão (não sai no orçamento)</span> <b>${brl(t.comissao)}</b></div>
      <div class="interno interno--sub"><span class="rotulo">Peso total · P.M.</span> <span>${numero(Math.round(t.peso * 100) / 100)} kg · ${brl(t.pm)}/kg</span></div>
      <p class="rotulo" style="margin:20px 0 8px">Compartilhar</p>
      <div class="acoes">
        <button class="btn" data-exportar="texto">Texto</button>
        <button class="btn" data-exportar="imagem">Imagem</button>
        <button class="btn" data-exportar="pdf">PDF</button>
      </div>
      <button class="btn btn--perigo btn--bloco" style="margin-top:8px" data-acao="limpar-orc">${ICONES.lixo} Limpar orçamento</button>
      <div class="acoes acoes--2">
        <button class="btn btn--contorno" data-acao="salvar-orc">${o.id ? 'Salvar alterações' : 'Salvar no histórico'}</button>
        <button class="btn btn--contorno" data-acao="novo-orc">Novo orçamento</button>
      </div>
      <p class="mudo" style="font-size:13px;margin:12px 0 0">Ao compartilhar, o orçamento é salvo no histórico automaticamente.</p>
    </div>` : ''}`;
}

async function salvarNoHistorico() {
  const o = estado.orc;
  if (!o.itens.length) return null;
  const linhas = linhasOrcamento();
  const t = totalizar(linhas);
  if (!o.id) o.id = uid();
  if (!o.numero) o.numero = await proximoNumero();
  const agora = new Date().toISOString();
  const reg = {
    id: o.id,
    numero: o.numero,
    clienteId: o.clienteId,
    cliente: o.cliente,
    clienteDoc: o.clienteDoc,
    vendedor: o.vendedor,
    faixaPadrao: o.faixaPadrao,
    condicao: o.condicao,
    recolheSt: !!o.recolheSt,
    clienteCodigo: o.clienteCodigo || '',
    itens: o.itens.map((i) => ({ ...i })),
    // Retrato dos valores no momento em que foi salvo (a tabela pode mudar depois).
    retrato: linhas.map((x) => ({ codigo: x.prod.codigo, descricao: x.prod.descricao, um: x.prod.um, qtd: x.qtd, faixa: (x.calc.emOferta ? 'Oferta · ' : '') + (estado.ds.faixas[x.k]?.nome || ''), unit: x.calc.unit, total: x.calc.total })),
    total: t.total,
    mercadoria: t.mercadoria,
    tabela: estado.ds.fontes?.pdf?.dataRef || null,
    criadoEm: estado.historico.find((h) => h.id === o.id)?.criadoEm || agora,
    atualizadoEm: agora,
  };
  estado.historico = [reg, ...estado.historico.filter((h) => h.id !== o.id)];
  salvarHistorico();
  enfileirar('historico', reg.id, reg);
  salvarOrc();
  return reg;
}

async function exportar(tipo) {
  const linhas = linhasOrcamento();
  if (!linhas.length) return;
  await salvarNoHistorico();
  renderOrcamento();
  const tot = totalizar(linhas);
  const orc = {
    ...estado.orc,
    vendedor: estado.orc.vendedor || estado.cfg.vendedor,
    ofertaValidade: ofertasAtivas()?.validade,
    condicaoTexto: nomeCondicao(condicaoAtual()),
  };
  try {
    if (tipo === 'texto') {
      const r = await compartilharTexto(gerarTexto(orc, linhas, tot, estado.ds));
      if (r === 'copiado') aviso('Texto copiado — cole no WhatsApp.');
      return;
    }
    aviso(tipo === 'pdf' ? 'Gerando PDF…' : 'Gerando imagem…');
    const arq = tipo === 'pdf' ? await gerarPdf(orc, linhas, tot, estado.ds) : await gerarImagem(orc, linhas, tot, estado.ds);
    const r = await compartilharArquivo(arq, `Orçamento Mantac nº ${orc.numero}`);
    if (r === 'baixado') aviso(`${arq.nome} salvo.`);
  } catch (e) {
    console.error(e);
    aviso('Não foi possível gerar: ' + e.message);
  }
}

async function novoOrcamento() {
  if (estado.orc.itens.length && !estado.orc.id && !(await confirmar('Este orçamento ainda não foi salvo no histórico. Descartar e começar outro?', 'Descartar', true))) return;
  estado.orc = orcVazio(estado.cfg);
  estado.pend = {};
  salvarOrc();
  fecharFolha();
  irPara('pedido');
  aviso('Novo orçamento');
}

function selecionarCliente(c) {
  Object.assign(estado.orc, { clienteId: c?.id || null, cliente: c?.nome || '', clienteDoc: c?.doc || '', clienteCodigo: c?.codigoErp || '', recolheSt: !!c?.recolheSt });
  salvarOrc();
  renderClienteCard();
}

// ---------- Detalhe do produto ----------
function textoSt(p) {
  const sit = situacaoSt(p, ctx());
  if (sit === 'sim') return `Sim · MVA ${pct(regraSt(p, ctx()).mva / 100)}`;
  return sit === 'indefinido' ? 'Não informado' : 'Não';
}

function abrirDetalhe(codigo) {
  const p = porCodigo.get(codigo);
  if (!p) return;
  $('#folha').dataset.tipo = 'produto';
  const faixas = estado.ds.faixas;
  const lc = linhaCatalogo(p.codigo);
  const c0 = calcularItem(p, faixas, 0, 1, ctx());
  const linhasFaixa = faixas
    .map((f, k) => {
      const c = calcularItem(p, faixas, k, 1, ctx());
      return `<tr><td><b>${esc(f.nome)}</b></td><td>${brl(c.unit)}</td><td><b>${brl(c.unitFinal)}</b></td><td class="com">${pct(c.comissaoPct)}</td></tr>`;
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
  abrirFolha(`
    <div class="folha__barra">
      <button class="btn-icone" data-acao="fechar" aria-label="Fechar">${ICONES.voltar}</button>
      <span class="rotulo">Produto</span>
      <button class="btn" data-add="${esc(p.codigo)}" data-de-detalhe>+ Orçamento</button>
    </div>
    ${lc?.linha.img ? `<div class="det__foto"><img src="${esc(lc.linha.img)}" alt="${esc(lc.linha.titulo)}" loading="lazy"></div>` : ''}
    <div class="det__cab">
      <span class="item__cod">${esc(p.codigo)}</span>
      <h2>${esc(p.descricao)}</h2>
      <span class="mudo" style="font-size:14px">${esc(p.classe)}${p.tipo ? ' · ' + esc(p.tipo) : ''}</span>
    </div>
    <h3 class="subtitulo">Preço por ${esc(p.um || 'un')}</h3>
    <table class="faixas">
      <thead><tr><th>Faixa</th><th>Unit.</th><th>C/ impostos</th><th>Comissão</th></tr></thead>
      <tbody>${linhasFaixa}</tbody>
    </table>
    ${c0.emOferta ? `<p class="aviso-oferta"><b>${esc(ofertasAtivas().nome)}:</b> ${brl(precoOferta(p, ctx()))}/${esc(p.um)} até ${dataBR(ofertasAtivas().validade)} (tabela ${brl(p.preco)}). As faixas incidem sobre o preço da oferta; comissão ${pct(c0.comissaoPct)}.</p>` : ''}
    <p class="mudo" style="font-size:13px;margin:8px 0 0">C/ impostos = unitário + IPI ${pct(p.ipi / 100)}${c0.temSt ? ' + ICMS-ST' : ''}${condicaoAtual().desconto ? ` · já com −${String(condicaoAtual().desconto).replace('.', ',')}% (${esc(condicaoAtual().nome)})` : ''}. Preço de tabela já inclui ICMS.</p>
    <h3 class="subtitulo">Dados comerciais</h3>
    <dl class="dados">
      <div><dt>Unidade</dt><dd>${esc(p.um)}</dd></div>
      <div><dt>Embalagem</dt><dd>${numero(p.emb)} ${esc(p.um)}</dd></div>
      <div><dt>Peso</dt><dd>${p.peso != null ? numero(p.peso) + ' kg/' + esc(p.um) : '—'}</dd></div>
      <div><dt>NCM</dt><dd>${esc(p.ncm || '—')}</dd></div>
      <div><dt>IPI</dt><dd>${pct(p.ipi / 100)}</dd></div>
      <div><dt>ICMS-ST</dt><dd>${textoSt(p)}</dd></div>
      ${regraSt(p, ctx())?.cest ? `<div><dt>CEST</dt><dd>${esc(regraSt(p, ctx()).cest)}</dd></div>` : ''}
      <div><dt>Vigência</dt><dd>${dataBR(p.vigencia)}</dd></div>
      <div><dt>Pagamento</dt><dd>${esc(nomeCondicao(condicaoAtual()))}</dd></div>
    </dl>
    ${tecnico}`);
}

// ---------- Clientes ----------
function filtrarClientes(q) {
  const t = norm(q).split(/\s+/).filter(Boolean);
  const d = soDigitos(q);
  return estado.clientes
    .filter((c) => {
      const chave = norm(`${c.nome} ${c.fantasia || ''} ${c.cidade || ''}`);
      return t.every((x) => chave.includes(x)) || (d.length >= 3 && soDigitos(c.doc).includes(d));
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function itemCliente(c, modo) {
  const n = estado.historico.filter((h) => h.clienteId === c.id).length;
  const sel = modo === 'escolher';
  return `<div class="cliente-item">
    <button class="item__abrir" ${sel ? `data-escolher="${esc(c.id)}"` : `data-editar-cliente="${esc(c.id)}"`}>
      <span class="item__desc">${esc(c.nome)}</span>
      <span class="item__meta">${esc(formatarDoc(c.doc) || 'Sem CNPJ')}${c.cidade ? ' · ' + esc(c.cidade) : ''}${n ? ` · ${n} orçamento${n > 1 ? 's' : ''}` : ''}</span>
    </button>
    ${sel ? '' : `<button class="btn btn--contorno btn--mini" data-orcar="${esc(c.id)}">Orçar</button>`}
  </div>`;
}

function renderClientes() {
  const q = $('#busca-clientes').value;
  const lista = filtrarClientes(q);
  $('#lista-clientes').innerHTML = estado.clientes.length
    ? lista.length
      ? lista.map((c) => itemCliente(c)).join('')
      : `<div class="vazio"><b>Nenhum cliente</b>Nada encontrado para “${esc(q)}”.</div>`
    : `<div class="vazio"><b>Nenhum cliente cadastrado</b>Toque em “+ Novo” para cadastrar.</div>`;
}

function abrirEscolhaCliente() {
  const atual = clienteAtual() || (estado.orc.cliente ? { nome: estado.orc.cliente } : null);
  abrirModal(`
    <div class="modal__cab"><h2 class="folha__titulo">Selecionar cliente</h2><button class="btn-icone btn-icone--sem-borda" data-acao="fechar-modal" aria-label="Fechar">${ICONES.x}</button></div>
    <div class="busca"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <input id="busca-escolha" type="search" autocomplete="off" placeholder="Nome, CNPJ ou cidade" aria-label="Buscar cliente"></div>
    <div id="lista-escolha" class="lista-escolha"></div>
    <div class="botoes" style="margin-top:12px">
      <button class="btn" data-acao="novo-cliente">+ Novo cliente</button>
      ${atual ? '<button class="btn btn--contorno" data-acao="limpar-cliente">Limpar seleção</button>' : ''}
    </div>`);
  const pintar = () => {
    const l = filtrarClientes($('#busca-escolha').value).slice(0, 50);
    $('#lista-escolha').innerHTML = l.length ? l.map((c) => itemCliente(c, 'escolher')).join('') : '<p class="mudo" style="padding:12px 0">Nenhum cliente encontrado.</p>';
  };
  $('#busca-escolha').addEventListener('input', pintar);
  pintar();
  setTimeout(() => $('#busca-escolha')?.focus(), 50);
}

function abrirFormCliente(id, depois) {
  const c = estado.clientes.find((x) => x.id === id) || { nome: '', doc: '', fantasia: '', cidade: '', telefone: '', email: '', obs: '' };
  const hist = id ? estado.historico.filter((h) => h.clienteId === id) : [];
  abrirModal(`
    <div class="modal__cab"><h2 class="folha__titulo">${id ? 'Editar cliente' : 'Novo cliente'}</h2><button class="btn-icone btn-icone--sem-borda" data-acao="fechar-modal" aria-label="Fechar">${ICONES.x}</button></div>
    <form id="form-cliente" class="form" data-id="${esc(id || '')}" data-depois="${esc(depois || '')}">
      <label class="campo"><span>CNPJ / CPF</span>
        <div class="campo__linha"><input name="doc" inputmode="numeric" autocomplete="off" value="${esc(formatarDoc(c.doc))}" placeholder="00.000.000/0000-00">
        <button type="button" class="btn btn--contorno btn--mini" data-acao="buscar-cnpj">Buscar</button></div>
        <small>“Buscar” preenche os dados pela Receita (BrasilAPI) — precisa de internet.</small>
      </label>
      <label class="campo"><span>Razão social / nome *</span><input name="nome" required autocomplete="off" value="${esc(c.nome)}"></label>
      <label class="campo"><span>Nome fantasia</span><input name="fantasia" autocomplete="off" value="${esc(c.fantasia || '')}"></label>
      <div class="grade2">
        <label class="campo"><span>Cód. cliente Mantac</span><input name="codigoErp" inputmode="numeric" autocomplete="off" value="${esc(c.codigoErp || '')}" placeholder="Ex.: 2244"></label>
        <label class="campo"><span>Inscrição estadual</span><input name="ie" autocomplete="off" value="${esc(c.ie || '')}"></label>
      </div>
      <label class="campo"><span>Cidade / UF</span><input name="cidade" autocomplete="off" value="${esc(c.cidade || '')}" placeholder="Curitiba/PR"></label>
      <div class="grade2">
        <label class="campo"><span>Telefone</span><input name="telefone" inputmode="tel" autocomplete="off" value="${esc(c.telefone || '')}"></label>
        <label class="campo"><span>E-mail</span><input name="email" type="email" autocomplete="off" value="${esc(c.email || '')}"></label>
      </div>
      <label class="campo"><span>Contato</span><input name="contato" autocomplete="off" value="${esc(c.contato || '')}"></label>
      <label class="check"><input type="checkbox" name="recolheSt" ${c.recolheSt ? 'checked' : ''}> <span><b>Cliente recolhe a ST</b><br><small class="mudo">Os orçamentos deste cliente saem sem ICMS-ST.</small></span></label>
      <label class="campo"><span>Observações</span><textarea name="obs">${esc(c.obs || '')}</textarea></label>
      <div class="botoes botoes--fim">
        ${id ? `<button type="button" class="btn btn--perigo" data-excluir-cliente="${esc(id)}">${ICONES.lixo} Excluir</button>` : ''}
        <button type="submit" class="btn">Salvar</button>
      </div>
      ${hist.length ? `<p class="rotulo" style="margin-top:20px">Orçamentos deste cliente</p>${hist.map(itemHistorico).join('')}` : ''}
    </form>`);
}

async function buscarCnpj() {
  const f = $('#form-cliente');
  const d = soDigitos(f.doc.value);
  if (d.length !== 14) return aviso('Digite um CNPJ com 14 dígitos.');
  aviso('Consultando CNPJ…');
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(r.status === 404 ? 'CNPJ não encontrado' : 'consulta indisponível');
    const j = await r.json();
    f.nome.value = j.razao_social || f.nome.value;
    f.fantasia.value = j.nome_fantasia || f.fantasia.value;
    if (j.municipio) f.cidade.value = `${j.municipio.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\B\w+/g, (m) => m.toLowerCase())}/${j.uf}`;
    if (j.ddd_telefone_1 && !f.telefone.value) f.telefone.value = j.ddd_telefone_1;
    if (j.email && !f.email.value) f.email.value = j.email.toLowerCase();
    f.doc.value = formatarDoc(d);
    aviso(j.descricao_situacao_cadastral && j.descricao_situacao_cadastral !== 'ATIVA' ? `Atenção: situação ${j.descricao_situacao_cadastral}` : 'Dados preenchidos');
  } catch (e) {
    aviso('Não foi possível consultar: ' + (e.name === 'AbortError' ? 'tempo esgotado' : e.message));
  }
}

function salvarCliente(form) {
  const dados = Object.fromEntries(new FormData(form));
  dados.recolheSt = form.recolheSt.checked;
  dados.nome = dados.nome.trim();
  if (!dados.nome) return aviso('Informe o nome do cliente.');
  dados.doc = soDigitos(dados.doc);
  let id = form.dataset.id;
  if (dados.doc && estado.clientes.some((c) => c.doc === dados.doc && c.id !== id)) return aviso('Já existe um cliente com esse CNPJ/CPF.');
  if (id) Object.assign(estado.clientes.find((c) => c.id === id), dados);
  else {
    id = uid();
    estado.clientes.push({ id, ...dados, criadoEm: new Date().toISOString() });
  }
  salvarClientes();
  enfileirar('clientes', id, estado.clientes.find((c) => c.id === id));
  // Mantém o nome do cliente atualizado no orçamento aberto.
  if (estado.orc.clienteId === id) selecionarCliente(estado.clientes.find((c) => c.id === id));
  const depois = form.dataset.depois;
  fecharModal();
  if (depois === 'selecionar') {
    selecionarCliente(estado.clientes.find((c) => c.id === id));
    irPara('pedido');
  } else if (estado.vista === 'clientes') renderClientes();
  aviso('Cliente salvo');
}

// ---------- Histórico ----------
const ehPedido = (h) => h.tipo === 'pedido';
const dataHist = (h) => h.data || h.atualizadoEm || '';

function itemHistorico(h) {
  return `<div class="hist-item${ehPedido(h) ? ' hist-item--pedido' : ''}">
    <button class="item__abrir" data-ver-orc="${esc(h.id)}">
      <span class="item__cod">${ehPedido(h) ? `Pedido oficial ${esc(h.numero)} · ${dataBR(h.data)}` : `Orçamento nº ${h.numero} · ${dataHora(h.atualizadoEm)}`}</span>
      <span class="item__desc">${esc(h.cliente || 'Sem cliente')}</span>
      <span class="item__meta">${h.itens.length} ite${h.itens.length === 1 ? 'm' : 'ns'} · ${esc(h.vendedor || '')}</span>
    </button>
    <b class="hist-item__total">${brl(h.total)}</b>
  </div>`;
}

function renderHistorico() {
  const q = $('#busca-historico').value.trim();
  const t = norm(q);
  const lista = estado.historico
    .filter((h) => !t || norm(`${h.cliente} ${h.numero} ${h.clienteCodigo || ''}`).includes(t) || String(h.numero) === t)
    .sort((a, b) => dataHist(b).localeCompare(dataHist(a)));
  $('#lista-historico').innerHTML = estado.historico.length
    ? lista.length
      ? lista.map(itemHistorico).join('')
      : `<div class="vazio"><b>Nada encontrado</b>Nenhum orçamento para “${esc(q)}”.</div>`
    : `<div class="vazio"><b>Nenhum orçamento salvo</b>Os orçamentos compartilhados ou salvos aparecem aqui. Pedidos oficiais podem ser importados no Painel.</div>`;
}

function verOrcamento(id) {
  const h = estado.historico.find((x) => x.id === id);
  if (!h) return;
  $('#folha').dataset.tipo = 'hist';
  if (ehPedido(h)) return verPedidoOficial(h);
  abrirFolha(`
    <div class="folha__barra">
      <div><h2 class="folha__titulo">Orçamento nº ${h.numero}</h2><span class="mudo">${dataHora(h.atualizadoEm)} · ${esc(h.vendedor || '')}</span></div>
      <button class="btn-icone" data-acao="fechar" aria-label="Fechar">${ICONES.x}</button>
    </div>
    <div class="cliente-card" style="margin-top:16px"><div class="cliente-card__info"><span class="rotulo">Cliente</span><b class="cliente-card__nome">${esc(h.cliente || 'Sem cliente')}</b><span class="mudo">${esc(formatarDoc(h.clienteDoc) || '')}</span></div></div>
    <table class="tabela-hist">
      <thead><tr><th>Item</th><th>Qtd</th><th>Total</th></tr></thead>
      <tbody>${h.retrato
        .map((r) => `<tr><td><b>${esc(r.codigo)}</b> ${esc(r.descricao)}<br><span class="mudo">${brl(r.unit)}/${esc(r.um)} · ${esc(r.faixa || '')}</span></td><td>${numero(r.qtd)} ${esc(r.um)}</td><td>${brl(r.total)}</td></tr>`)
        .join('')}</tbody>
      <tfoot><tr><td colspan="2">Total com impostos</td><td>${brl(h.total)}</td></tr></tfoot>
    </table>
    <p class="mudo" style="font-size:13px">Valores de quando foi salvo${h.tabela ? ` (tabela de ${dataBR(h.tabela)})` : ''}. Ao reabrir, os preços são recalculados pela tabela atual.</p>
    <div class="acoes acoes--2" style="margin-top:16px">
      <button class="btn" data-reabrir="${esc(h.id)}">Reabrir e editar</button>
      <button class="btn btn--contorno" data-duplicar="${esc(h.id)}">Duplicar como novo</button>
    </div>
    <button class="btn btn--perigo btn--bloco" style="margin-top:8px" data-excluir-orc="${esc(h.id)}">${ICONES.lixo} Excluir do histórico</button>`);
}

function verPedidoOficial(h) {
  const t = h.totais || {};
  abrirFolha(`
    <div class="folha__barra">
      <div><h2 class="folha__titulo">Pedido oficial ${esc(h.numero)}</h2><span class="mudo">${dataBR(h.data)}${h.entrega ? ` · entrega ${dataBR(h.entrega)}` : ''}</span></div>
      <button class="btn-icone" data-acao="fechar" aria-label="Fechar">${ICONES.x}</button>
    </div>
    <div class="cliente-card" style="margin-top:16px"><div class="cliente-card__info"><span class="rotulo">Cliente</span><b class="cliente-card__nome">${esc(h.cliente || '—')}</b><span class="mudo">${h.clienteCodigo ? `Cód. ${esc(h.clienteCodigo)} · ` : ''}${esc(formatarDoc(h.clienteDoc) || '')}</span></div></div>
    <dl class="dados" style="margin-top:12px">
      <div><dt>Pagamento</dt><dd>${esc(h.condicaoTexto || '—')}</dd></div>
      <div><dt>Comissão</dt><dd>${h.comissao != null ? esc(String(h.comissao).replace('.', ',')) + '%' : '—'}</dd></div>
      <div><dt>Peso</dt><dd>${t.peso != null ? numero(t.peso) + ' kg' : '—'}</dd></div>
    </dl>
    ${h.obs ? `<p class="aviso-oferta" style="margin-top:12px"><b>Obs.:</b> ${esc(h.obs)}</p>` : ''}
    <table class="tabela-hist">
      <thead><tr><th>Item</th><th>Qtd</th><th>Total</th></tr></thead>
      <tbody>${h.retrato
        .map((r) => `<tr><td><b>${esc(r.codigo)}</b> ${esc(r.descricao)}<br><span class="mudo">${brl(r.unit)}/${esc(r.um)} · IPI ${pct((r.ipi || 0) / 100)}${r.st ? ` · ST ${brl(r.st)}` : ''}${porCodigo.has(r.codigo) ? '' : ' · fora da tabela atual'}</span></td><td>${numero(r.qtd)} ${esc(r.um)}</td><td>${brl(r.total)}</td></tr>`)
        .join('')}</tbody>
      <tfoot>
        <tr><td colspan="2" class="sub">Mercadorias</td><td class="sub">${brl(t.mercadoria)}</td></tr>
        <tr><td colspan="2" class="sub">IPI</td><td class="sub">${brl(t.ipi)}</td></tr>
        ${t.st ? `<tr><td colspan="2" class="sub">ICMS-ST</td><td class="sub">${brl(t.st)}</td></tr>` : ''}
        <tr><td colspan="2">Total</td><td>${brl(h.total)}</td></tr>
      </tfoot>
    </table>
    <p class="mudo" style="font-size:13px">Importado da cópia do pedido Mantac${h.arquivo ? ` (${esc(h.arquivo)})` : ''}. “Duplicar” abre um orçamento novo com os mesmos itens e quantidades, pelos preços atuais.</p>
    <div class="acoes acoes--2" style="margin-top:16px">
      <button class="btn" data-duplicar="${esc(h.id)}">Duplicar como orçamento</button>
      <button class="btn btn--perigo" data-excluir-orc="${esc(h.id)}">${ICONES.lixo} Excluir</button>
    </div>`);
}

async function carregarDoHistorico(id, duplicar) {
  const h = estado.historico.find((x) => x.id === id);
  if (!h) return;
  if (estado.orc.itens.length && !estado.orc.id && !(await confirmar('O orçamento aberto não foi salvo. Substituir?', 'Substituir', true))) return;
  const itens = h.itens.filter((i) => porCodigo.has(i.codigo)).map((i) => ({ ...i }));
  const fora = h.itens.length - itens.length;
  estado.orc = {
    ...orcVazio(estado.cfg),
    id: duplicar ? null : h.id,
    numero: duplicar ? null : h.numero,
    clienteId: h.clienteId,
    cliente: h.cliente,
    clienteDoc: h.clienteDoc,
    vendedor: duplicar ? estado.cfg.vendedor : h.vendedor,
    faixaPadrao: h.faixaPadrao ?? 0,
    condicao:
      h.condicao ||
      (h.aVista ? 'avista' : null) ||
      condicoes().find((c) => h.condicaoTexto && norm(h.condicaoTexto).startsWith(norm(c.nome)))?.id ||
      '28dd',
    recolheSt: !!h.recolheSt || (ehPedido(h) && /RECOLHE\s+A\s+ST/i.test(h.obs || '')),
    clienteCodigo: h.clienteCodigo || '',
    itens,
  };
  salvarOrc();
  fecharFolha();
  irPara('pedido');
  abrirOrcamento();
  aviso(fora ? `${fora} item(ns) não existem mais na tabela e ficaram de fora` : duplicar ? 'Cópia aberta como novo orçamento' : `Orçamento nº ${h.numero} reaberto`);
}

// ---------- Painel ----------
function renderPainel() {
  setTimeout(() => {
    renderStatusSync();
    carregarUsuarios();
  });
  const ds = estado.ds;
  const f = ds.fontes || {};
  const st = estado.cfg.st;
  const pv = estado.previa;
  const tab = estado.st?.porCodigo || {};
  const fora = ds.produtos.filter((p) => !(p.codigo in tab));
  const ncmsFora = new Map();
  for (const p of fora) if (p.ncm) ncmsFora.set(p.ncm, (ncmsFora.get(p.ncm) || 0) + 1);
  const comSt = ds.produtos.filter((p) => tab[p.codigo]).length;
  const stResumo = {
    fora,
    ncmsFora,
    html: estado.st
      ? `<p><b>Tabela: ${esc(estado.st.arquivo || 'PR ST')}</b><br>${comSt} produtos com ST · ${ds.produtos.length - comSt - fora.length} sem ST · compartilhada com todos</p>
`
      : '<p>Nenhuma tabela de ST carregada. Envie o PDF “PR ST” em Atualizar tabela.</p>',
  };
  const eu = api.usuario();
  $('#painel').innerHTML = `
    <div class="cartao">
      <h3>Conta e sincronização</h3>
      <p><b>${esc(eu?.nome || eu?.email || '—')}</b>${eu?.is_admin ? ' · administrador' : ''}<br><span class="mudo">${esc(eu?.email || '')}</span></p>
      <p id="status-sync" class="mudo" style="font-size:14px"></p>
      <div class="botoes">
        <button class="btn btn--contorno" data-acao="sincronizar">Sincronizar agora</button>
        <button class="btn btn--perigo" data-acao="sair">Sair</button>
      </div>
    </div>

    ${eu?.is_admin ? `<div class="cartao">
      <h3>Usuários</h3>
      <p>Só quem estiver nesta lista entra no app (login Google). A conta também precisa estar entre os “usuários de teste” do login Google do app de vendas.</p>
      <div id="lista-usuarios"><p class="mudo">Carregando…</p></div>
      <form id="form-usuario" class="form" style="margin-top:12px">
        <div class="grade2">
          <label class="campo"><span>E-mail Google</span><input name="email" type="email" required autocomplete="off" placeholder="nome@gmail.com"></label>
          <label class="campo"><span>Nome</span><input name="nome" autocomplete="off"></label>
        </div>
        <label class="check"><input type="checkbox" name="is_admin"> <span>Administrador (gerencia usuários)</span></label>
        <div class="botoes"><button class="btn" type="submit">+ Adicionar usuário</button></div>
      </form>
    </div>` : ''}

    <div class="cartao">
      <h3>Tabela ativa</h3>
      <p><b>${esc(f.pdf?.lista || 'Tabela 44')}</b><br>
      Data de referência ${dataBR(f.pdf?.dataRef)} · ${ds.produtos.length} produtos · compartilhada com todos os usuários</p>
      <p class="mudo" style="font-size:14px">
        PDF: ${esc(f.pdf?.arquivo || '—')} (${dataBR(f.pdf?.em)})<br>
        Planilha: ${esc(f.xls?.arquivo || '—')} (${dataBR(f.xls?.em)})<br>
        Faixas: ${ds.faixas.map((x) => `${esc(x.nome)} (comissão ${pct(x.comissao)})`).join(' · ')}
      </p>
    </div>

    <div class="cartao">
      <h3>Atualizar tabela</h3>
      <p>Envie a <b>Lista de Preços de Venda (PDF do Prosyst)</b>, a <b>planilha de descontos (XLS/XLSX)</b> ou a <b>tabela de ICMS-ST do PR (PDF)</b> — o app reconhece o tipo. A lista substitui os produtos; a planilha atualiza preços, faixas, comissões e preços especiais; a tabela de ST define MVA e CEST por produto.</p>
      <label class="upload" id="upload">
        <input type="file" id="arquivo" accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        <b class="rotulo" style="color:var(--azul)">Escolher arquivo</b>
        <span class="mudo" style="font-size:14px">PDF, XLS ou XLSX</span>
      </label>
      ${pv ? `<div class="previa">
        <b>${esc(pv.arquivo)}</b>
        <ul>${pv.linhas.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        <div class="botoes"><button class="btn" data-acao="confirmar">Aplicar</button><button class="btn btn--contorno" data-acao="descartar">Cancelar</button></div>
      </div>` : ''}
    </div>

    <div class="cartao">
      <h3>Importar pedidos para o histórico</h3>
      <p>Envie as <b>cópias de pedido oficial</b> (PDF do Prosyst, “Pedido N°”). Pode selecionar vários de uma vez. Cada pedido vai para o Histórico do cliente; cliente novo é cadastrado pelo CNPJ (código Mantac, IE, contato e cidade vêm do pedido).</p>
      <label class="upload" id="upload-pedidos">
        <input type="file" id="arquivo-pedidos" accept=".pdf,application/pdf" multiple>
        <b class="rotulo" style="color:var(--azul)">Escolher pedidos (PDF)</b>
        <span class="mudo" style="font-size:14px">${estado.historico.filter(ehPedido).length} pedidos oficiais no histórico</span>
      </label>
      ${estado.previaPedidos ? `<div class="previa" id="previa-pedidos">
        ${estado.previaPedidos.lidos.length ? `<b>${estado.previaPedidos.lidos.length} pedido(s) lido(s)</b>
        <ul>${estado.previaPedidos.lidos
          .map((p) => {
            const existe = estado.historico.some((h) => h.id === 'pedido-' + p.numero);
            const cli = clientePorDoc(p.cnpj);
            return `<li><b>${esc(p.numero)}</b> · ${dataBR(p.data)} · ${esc(p.cliente)} · ${p.itens.length} itens · ${brl(p.totais.total)}${cli ? '' : ' · <i>cliente novo</i>'}${existe ? ' · <i>substitui o já importado</i>' : ''}</li>`;
          })
          .join('')}</ul>` : ''}
        ${estado.previaPedidos.erros.length ? `<p style="color:var(--erro)">Não lidos: ${estado.previaPedidos.erros.map(esc).join(' · ')}</p>` : ''}
        <div class="botoes">
          ${estado.previaPedidos.lidos.length ? '<button class="btn" data-acao="importar-pedidos">Importar para o histórico</button>' : ''}
          <button class="btn btn--contorno" data-acao="descartar-pedidos">Cancelar</button>
        </div>
      </div>` : ''}
    </div>

    <div class="cartao">
      <h3>ICMS-ST (clientes do PR)</h3>
      ${stResumo.html}
      <label class="check"><input type="checkbox" data-st-ipi ${st.ipiNaBase !== false ? 'checked' : ''}> <span><b>Incluir o IPI na base da ST</b><br><small class="mudo">Regra legal: a base da ST é (mercadoria + IPI) × (1 + MVA). Desligado, o cálculo fica igual ao “%ST” da tabela da Mantac (sem IPI).</small></span></label>
      <div class="grade2" style="margin:16px 0">
        <label class="campo"><span>ICMS interno PR (%)</span><input type="number" step="0.01" data-st="aliqInterna" value="${st.aliqInterna}"></label>
        <label class="campo"><span>ICMS interestadual (%)</span><input type="number" step="0.01" data-st="aliqInter" value="${st.aliqInter}"></label>
      </div>
      <p class="mudo" style="font-size:13px">ST = (mercadoria${st.ipiNaBase !== false ? ' + IPI' : ''}) × (1 + MVA) × ICMS interno − mercadoria × ICMS interestadual. A MVA e o ICMS interno de cada produto vêm da tabela de ST.</p>
      ${stResumo.fora.length ? `<details class="detalhes">
        <summary>${stResumo.fora.length} produtos da Tabela 44 não estão na tabela de ST</summary>
        <p class="mudo" style="font-size:13px;margin-top:8px">Hoje ficam sem ST. Se algum tiver ST, preencha a MVA pelo NCM (vale só para esses produtos):</p>
        <table class="tabela-ncm">
          <thead><tr><th>NCM</th><th>Itens</th><th style="text-align:right">MVA %</th></tr></thead>
          <tbody>${[...stResumo.ncmsFora.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([n, q]) => `<tr><td>${esc(n)}</td><td>${q}</td><td style="text-align:right"><input type="number" step="0.01" inputmode="decimal" data-mva="${esc(n)}" value="${st.ncms[n]?.mva ?? ''}" placeholder="—" aria-label="MVA do NCM ${esc(n)}"></td></tr>`)
            .join('')}</tbody>
        </table>
        <p class="mudo" style="font-size:13px;margin-top:8px">${stResumo.fora.map((p) => `${esc(p.codigo)}`).join(', ')}</p>
      </details>` : ''}
      <label class="campo" style="margin-top:16px"><span>Códigos sem ST (exceções)</span>
        <textarea data-semst placeholder="Ex.: 9700, 9701">${esc((st.semSt || []).join(', '))}</textarea>
        <small>Separados por vírgula ou espaço. Ficam sem ST em qualquer caso.</small>
      </label>
    </div>

    <div class="cartao">
      <h3>Ofertas</h3>
      ${estado.ofertas ? `<p><b>${esc(estado.ofertas.nome)}</b> · ${Object.keys(estado.ofertas.precos || {}).length} códigos · ${dataBR(estado.ofertas.inicio)} a ${dataBR(estado.ofertas.validade)} · comissão ${pct(estado.ofertas.comissao ?? 0)}<br>
        <span class="${ofertasAtivas() ? '' : 'mudo'}">${ofertasAtivas() ? 'Valendo agora.' : 'Fora do período — os preços de tabela voltam automaticamente.'}</span>
</p>` : '<p>Nenhuma oferta cadastrada.</p>'}
      <details class="detalhes detalhes--neutro">
        <summary>Editar / cadastrar ofertas</summary>
        <form id="form-ofertas" class="form" style="margin-top:12px">
          <label class="campo"><span>Nome da campanha</span><input name="nome" value="${esc(estado.ofertas?.nome || '')}" placeholder="Outubro de Ofertas"></label>
          <div class="grade2">
            <label class="campo"><span>Início</span><input type="date" name="inicio" value="${esc(estado.ofertas?.inicio || '')}"></label>
            <label class="campo"><span>Validade</span><input type="date" name="validade" value="${esc(estado.ofertas?.validade || '')}" required></label>
          </div>
          <label class="campo"><span>Comissão na oferta (%)</span><input type="number" step="0.5" name="comissao" value="${Math.round((estado.ofertas?.comissao ?? 0.08) * 1000) / 10}"></label>
          <label class="campo"><span>Preços (um por linha: código preço)</span>
            <textarea name="precos" rows="8" style="font-family:ui-monospace,monospace;font-size:14px">${esc(Object.entries(estado.ofertas?.precos || {}).map(([c, v]) => `${c} ${String(v).replace('.', ',')}`).join('\n'))}</textarea>
            <small>Preço líquido por unidade (m, pç, kg), como no folheto. Ex.: <code>3773 3,19</code></small>
          </label>
          <div class="botoes">
            <button class="btn" type="submit">Salvar ofertas</button>
          </div>
        </form>
      </details>
    </div>

    <div class="cartao">
      <h3>Condições de pagamento</h3>
      <p>Desconto aplicado em todos os itens do orçamento conforme a condição escolhida.</p>
      <table class="tabela-ncm">
        <thead><tr><th>Condição</th><th style="text-align:right">Desconto %</th></tr></thead>
        <tbody>${condicoes()
          .map((c, i) => `<tr><td><input type="text" data-cond-nome="${i}" value="${esc(c.nome)}" style="width:100%;text-align:left" aria-label="Nome da condição"></td><td style="text-align:right"><input type="number" step="0.5" data-cond-desc="${i}" value="${c.desconto}" aria-label="Desconto da condição ${esc(c.nome)}"></td></tr>`)
          .join('')}</tbody>
      </table>
    </div>

    <div class="cartao">
      <h3>Vendedor</h3>
      <label class="campo"><span>Nome no orçamento</span><input type="text" data-cfg="vendedor" value="${esc(estado.cfg.vendedor)}"></label>
    </div>

    <div class="cartao">
      <h3>Backup dos dados</h3>
      <p>Clientes, histórico (${estado.historico.length} orçamentos) e configurações ficam só neste aparelho. Exporte um backup de vez em quando ou para passar para outro aparelho.</p>
      <div class="botoes">
        <button class="btn btn--contorno" data-acao="exportar-backup">Exportar backup</button>
        <label class="btn btn--contorno">Importar backup<input type="file" id="arquivo-backup" accept=".json,application/json" hidden></label>
      </div>
    </div>
    <p class="mudo" style="font-size:13px">Mantac Pedidos · ${estado.clientes.length} clientes · dados salvos só neste aparelho · funciona offline.</p>`;
}

function renderStatusSync() {
  const el = $('#status-sync');
  if (!el) return;
  const n = estado.fila.length;
  el.innerHTML = `${estado.ultimoSync ? `Sincronizado às ${new Date(estado.ultimoSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Ainda não sincronizado nesta sessão'}${n ? ` · <b>${n} alteração(ões) aguardando envio</b>` : ' · tudo enviado'}${estado.erroSync ? `<br><span style="color:var(--erro)">${esc(estado.erroSync)}</span>` : ''}`;
}

async function carregarUsuarios() {
  const el = $('#lista-usuarios');
  if (!el) return;
  try {
    estado.usuarios = await api.chamar('GET', '/usuarios');
  } catch (e) {
    el.innerHTML = `<p style="color:var(--erro)">${esc(e.message)}</p>`;
    return;
  }
  const eu = api.usuario();
  el.innerHTML = estado.usuarios
    .map(
      (u) => `<div class="cliente-item">
      <div class="item__abrir" style="cursor:default"><span class="item__desc">${esc(u.nome || u.email)}${u.is_admin ? ' <span class="selo">admin</span>' : ''}${u.ativo ? '' : ' <span class="selo selo--st">inativo</span>'}</span>
      <span class="item__meta">${esc(u.email)}${u.ultimo_acesso ? ' · último acesso ' + dataHora(u.ultimo_acesso) : ' · nunca entrou'}</span></div>
      ${u.id === eu?.id ? '' : `<button class="btn btn--perigo btn--mini" data-remover-usuario="${u.id}">Remover</button>`}
    </div>`
    )
    .join('');
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
      if (r.tipo === 'pedido') {
        estado.previaPedidos = { lidos: [{ ...r, arquivo: nome }], erros: [] };
        return renderPainel();
      }
      if (r.tipo === 'st') {
        const porCodigo = {};
        for (const p of r.produtos) porCodigo[p.codigo] = p.st ? { mva: p.mva, aliqInterna: p.aliqInterna, pst: p.pst, cest: p.cest } : null;
        const novoSt = { arquivo: nome, em: new Date().toISOString(), porCodigo, origem: 'upload' };
        const cods = new Set(estado.ds.produtos.map((p) => p.codigo));
        const mudou = estado.ds.produtos.filter((p) => JSON.stringify(estado.st?.porCodigo?.[p.codigo] ?? 'x') !== JSON.stringify(porCodigo[p.codigo] ?? 'x')).length;
        estado.previa = {
          arquivo: nome,
          st: novoSt,
          linhas: [
            `Tabela de ICMS-ST: ${r.produtos.length} produtos (${r.produtos.filter((p) => p.st).length} com ST)`,
            `${estado.ds.produtos.filter((p) => !(p.codigo in porCodigo)).length} produtos da Tabela 44 ficam fora da tabela de ST`,
            `${r.produtos.filter((p) => !cods.has(p.codigo)).length} códigos da tabela de ST não existem na Tabela 44`,
            `${mudou} produtos mudam de situação ou MVA`,
          ],
        };
        return renderPainel();
      }
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
    const resumo = comparar(estado.ds, novo);
    estado.previa = {
      arquivo: nome,
      ds: novo,
      linhas: [`${resumo.total} produtos após a importação`, `${resumo.novos} novos · ${resumo.removidos} removidos`, `${resumo.precoAlterado} com preço alterado`, extra].filter(Boolean),
    };
  } catch (e) {
    console.error(e);
    aviso('Erro: ' + e.message);
  }
  renderPainel();
}

async function salvarOfertas(form) {
  const f = Object.fromEntries(new FormData(form));
  const precos = {};
  const invalidos = [];
  for (const linha of f.precos.split(/\n+/)) {
    const m = /^\s*([0-9][0-9A-Za-z.-]*)\s*[;:\t ]\s*R?\$?\s*([\d.,]+)\s*$/.exec(linha);
    if (!linha.trim()) continue;
    if (!m) {
      invalidos.push(linha.trim());
      continue;
    }
    const cod = m[1].replace(/\.(?=\d{3}$)/, ''); // "27.605" -> "27605"
    const v = Number(m[2].replace(/\.(?=\d{3}(,|$))/g, '').replace(',', '.'));
    if (!porCodigo.has(cod) || !(v > 0)) invalidos.push(linha.trim());
    else precos[cod] = v;
  }
  if (invalidos.length && !(await confirmar(`${invalidos.length} linha(s) ignorada(s) (código inexistente ou preço inválido): ${invalidos.slice(0, 5).join(' | ')}${invalidos.length > 5 ? '…' : ''}. Salvar o resto?`, 'Salvar'))) return;
  const valor = {
    nome: f.nome.trim() || 'Ofertas',
    inicio: f.inicio || null,
    validade: f.validade,
    comissao: (Number(f.comissao) || 0) / 100,
    precos,
  };
  try {
    await api.chamar('PUT', '/dados/ofertas', { valor });
  } catch (e) {
    if (e instanceof api.ErroSessao) return sessaoExpirada(e.message);
    return aviso('Não foi possível salvar no servidor: ' + e.message);
  }
  aplicarDado('ofertas', valor);
  renderPainel();
  aviso(`${Object.keys(precos).length} ofertas salvas`);
}

// ---------- Importar pedidos oficiais ----------
async function lerPedidos(files) {
  const { lerPdf } = await import('./importar.js');
  const lidos = [];
  const erros = [];
  for (const f of files) {
    try {
      const r = await lerPdf(f);
      if (r.tipo !== 'pedido') throw new Error('não é uma cópia de pedido');
      lidos.push({ ...r, arquivo: f.name });
    } catch (e) {
      erros.push(`${f.name}: ${e.message}`);
    }
  }
  estado.previaPedidos = { lidos, erros };
  renderPainel();
  if (lidos.length) $('#previa-pedidos')?.scrollIntoView({ block: 'center' });
}

function clientePorDoc(doc) {
  const d = soDigitos(doc);
  return d ? estado.clientes.find((c) => soDigitos(c.doc) === d) : null;
}

function importarPedidos() {
  const { lidos } = estado.previaPedidos || { lidos: [] };
  let novosClientes = 0;
  for (const p of lidos) {
    let c = clientePorDoc(p.cnpj) || (p.codigoCliente && estado.clientes.find((x) => x.codigoErp === p.codigoCliente));
    const dadosCli = {
      nome: p.cliente,
      doc: p.cnpj,
      codigoErp: p.codigoCliente,
      ie: p.ie,
      email: p.email,
      telefone: p.telefone,
      contato: p.contato,
      cidade: p.cidade,
    };
    if (!c) {
      c = { id: uid(), ...dadosCli, recolheSt: /RECOLHE\s+A\s+ST/i.test(p.obs || ''), criadoEm: new Date().toISOString() };
      estado.clientes.push(c);
      novosClientes++;
    } else {
      // Completa só o que estiver vazio; não sobrescreve o que foi digitado no app.
      for (const [k, v] of Object.entries(dadosCli)) if (v && !c[k]) c[k] = v;
      if (/RECOLHE\s+A\s+ST/i.test(p.obs || '')) c.recolheSt = true;
    }
    const id = 'pedido-' + p.numero;
    const agora = new Date().toISOString();
    const reg = {
      id,
      tipo: 'pedido',
      numero: p.numero,
      data: p.data,
      entrega: p.entrega,
      clienteId: c.id,
      cliente: p.cliente,
      clienteDoc: p.cnpj,
      clienteCodigo: p.codigoCliente,
      vendedor: p.representante,
      comissao: p.comissao,
      condicaoTexto: p.condicao,
      obs: p.obs,
      arquivo: p.arquivo,
      itens: p.itens.map((i) => ({ codigo: i.codigo, qtd: i.qtd, k: 0 })),
      retrato: p.itens.map((i) => ({ codigo: i.codigo, descricao: i.descricao, um: i.um, qtd: i.qtd, unit: i.unit, ipi: i.ipi, st: i.st, total: i.total, peso: i.peso, pm: i.pm })),
      totais: p.totais,
      total: p.totais.total ?? p.itens.reduce((s, i) => s + (i.total || 0), 0),
      mercadoria: p.totais.mercadoria,
      criadoEm: estado.historico.find((h) => h.id === id)?.criadoEm || agora,
      atualizadoEm: agora,
    };
    estado.historico = [reg, ...estado.historico.filter((h) => h.id !== id)];
    enfileirar('clientes', c.id, c, false);
    enfileirar('historico', reg.id, reg, false);
  }
  salvarClientes();
  salvarHistorico();
  enviarFila();
  estado.previaPedidos = null;
  renderPainel();
  aviso(`${lidos.length} pedido(s) no histórico${novosClientes ? ` · ${novosClientes} cliente(s) novo(s)` : ''}`);
}

function exportarBackup() {
  const dados = { app: 'mantac-pedidos', versao: 1, em: new Date().toISOString(), cfg: estado.cfg, clientes: estado.clientes, historico: estado.historico, seq: estado.seq };
  const blob = new Blob([JSON.stringify(dados)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mantac-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

async function importarBackup(file) {
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== 'mantac-pedidos') throw new Error('arquivo não é um backup do Mantac Pedidos');
    if (!(await confirmar(`Juntar ${d.clientes?.length || 0} clientes e ${d.historico?.length || 0} orçamentos do backup com os dados deste aparelho?`, 'Importar'))) return;
    const cli = new Map(estado.clientes.map((c) => [c.id, c]));
    for (const c of d.clientes || []) cli.set(c.id, c);
    const his = new Map(estado.historico.map((h) => [h.id, h]));
    for (const h of d.historico || []) if (!his.has(h.id) || his.get(h.id).atualizadoEm < h.atualizadoEm) his.set(h.id, h);
    estado.clientes = [...cli.values()];
    estado.historico = [...his.values()].sort((a, b) => (b.atualizadoEm || '').localeCompare(a.atualizadoEm || ''));
    estado.seq = Math.max(estado.seq, d.seq || 0, ...estado.historico.map((h) => h.numero || 0));
    if (d.cfg) estado.cfg = { ...estado.cfg, ...d.cfg, st: { ...estado.cfg.st, ...d.cfg.st } };
    await Promise.all([salvarClientes(), salvarHistorico(), db.gravar('seq', estado.seq)]);
    salvarCfg();
    for (const c of d.clientes || []) enfileirar('clientes', c.id, cli.get(c.id), false);
    for (const h of d.historico || []) enfileirar('historico', h.id, his.get(h.id), false);
    enviarFila();
    renderPainel();
    aviso('Backup importado');
  } catch (e) {
    aviso('Erro no backup: ' + e.message);
  }
}

// ---------- Eventos ----------
function ligarEventos() {
  let t;
  $('#busca').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      estado.busca = e.target.value;
      estado.limite = 30;
      renderResultados();
    }, 120);
  });
  $('#busca-clientes').addEventListener('input', renderClientes);
  $('#busca-historico').addEventListener('input', renderHistorico);
  $('#mais').addEventListener('click', () => {
    estado.limite += 30;
    renderResultados();
  });

  document.addEventListener('submit', (e) => {
    if (e.target.id === 'form-cliente') {
      e.preventDefault();
      salvarCliente(e.target);
    }
    if (e.target.id === 'form-usuario') {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      api
        .chamar('POST', '/usuarios', { email: f.email, nome: f.nome, is_admin: e.target.is_admin.checked })
        .then(() => {
          e.target.reset();
          aviso('Usuário adicionado');
          carregarUsuarios();
        })
        .catch((err) => aviso(err.message));
    }
    if (e.target.id === 'form-ofertas') {
      e.preventDefault();
      salvarOfertas(e.target);
    }
  });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest(
      '#ofertas-chip,[data-remover-usuario],[data-condicao],[data-ir],[data-acao],[data-abrir],[data-add],[data-pend],[data-faixa-padrao],[data-faixa-item],[data-passo],[data-remover],[data-exportar],[data-escolher],[data-editar-cliente],[data-orcar],[data-excluir-cliente],[data-ver-orc],[data-reabrir],[data-duplicar],[data-excluir-orc],[data-historico-cliente]'
    );
    if (!el) return;
    const d = el.dataset;
    if (d.ir) {
      fecharFolha();
      return irPara(d.ir);
    }
    if (d.abrir) return abrirDetalhe(d.abrir);
    if (d.add) {
      const p = porCodigo.get(d.add);
      const it = adicionar(p.codigo, d.deDetalhe !== undefined ? p.emb : qtdPendente(p));
      delete estado.pend[p.codigo];
      if (d.deDetalhe !== undefined) fecharFolha();
      atualizarCard(p.codigo);
      return aviso(`${p.codigo} · ${numero(it.qtd)} ${p.um} no orçamento`);
    }
    if (d.pend) {
      const p = porCodigo.get(d.pend);
      estado.pend[p.codigo] = Math.max(p.emb, qtdPendente(p) + Number(d.d) * p.emb);
      return atualizarCard(p.codigo);
    }
    if (el.id === 'ofertas-chip') {
      estado.soOfertas = !estado.soOfertas;
      estado.limite = 30;
      renderOfertasChip();
      return renderResultados();
    }
    if (d.condicao) {
      estado.orc.condicao = d.condicao;
      salvarOrc();
      renderBarra();
      renderOrcamento();
      return aviso(`Pagamento: ${nomeCondicao(condicaoAtual())}`);
    }
    if (d.faixaPadrao !== undefined) {
      estado.orc.faixaPadrao = Number(d.faixaPadrao);
      salvarOrc();
      renderFaixaPadrao();
      return renderResultados();
    }
    const linha = el.closest('[data-linha]');
    if (d.remover) {
      estado.orc.itens = estado.orc.itens.filter((i) => i.codigo !== d.remover);
      salvarOrc();
      renderBarra();
      renderOrcamento();
      return atualizarCard(d.remover);
    }
    if (linha && (d.faixaItem !== undefined || d.passo)) {
      const it = estado.orc.itens.find((i) => i.codigo === linha.dataset.linha);
      const p = porCodigo.get(it.codigo);
      if (d.faixaItem !== undefined) it.k = Number(d.faixaItem);
      else it.qtd = Math.max(p.emb, it.qtd + Number(d.passo) * p.emb);
      salvarOrc();
      renderBarra();
      return renderOrcamento();
    }
    if (d.exportar) return exportar(d.exportar);
    if (d.escolher) {
      selecionarCliente(estado.clientes.find((c) => c.id === d.escolher));
      return fecharModal();
    }
    if (d.editarCliente) return abrirFormCliente(d.editarCliente);
    if (d.orcar) {
      selecionarCliente(estado.clientes.find((c) => c.id === d.orcar));
      irPara('pedido');
      return aviso('Cliente selecionado no pedido');
    }
    if (el.dataset.removerUsuario) {
      if (!(await confirmar('Remover o acesso deste usuário?', 'Remover', true))) return;
      try {
        await api.chamar('DELETE', '/usuarios/' + el.dataset.removerUsuario);
        aviso('Usuário removido');
      } catch (e) {
        aviso(e.message);
      }
      return carregarUsuarios();
    }
    if (d.excluirCliente) {
      if (!(await confirmar('Excluir este cliente? Os orçamentos do histórico continuam salvos.', 'Excluir', true))) return;
      estado.clientes = estado.clientes.filter((c) => c.id !== d.excluirCliente);
      salvarClientes();
      enfileirar('clientes', d.excluirCliente, null);
      fecharModal();
      if (estado.orc.clienteId === d.excluirCliente) estado.orc.clienteId = null;
      renderClientes();
      return aviso('Cliente excluído');
    }
    if (d.historicoCliente) {
      $('#busca-historico').value = estado.clientes.find((c) => c.id === d.historicoCliente)?.nome || '';
      return irPara('historico');
    }
    if (d.verOrc) {
      fecharModal();
      return verOrcamento(d.verOrc);
    }
    if (d.reabrir) return carregarDoHistorico(d.reabrir, false);
    if (d.duplicar) return carregarDoHistorico(d.duplicar, true);
    if (d.excluirOrc) {
      if (!(await confirmar('Excluir este orçamento do histórico?', 'Excluir', true))) return;
      estado.historico = estado.historico.filter((h) => h.id !== d.excluirOrc);
      salvarHistorico();
      enfileirar('historico', d.excluirOrc, null);
      if (estado.orc.id === d.excluirOrc) Object.assign(estado.orc, { id: null, numero: null });
      fecharFolha();
      renderHistorico();
      return aviso('Orçamento excluído');
    }
    switch (d.acao) {
      case 'fechar':
        fecharFolha();
        if (estado.vista === 'pedido') renderResultados();
        return;
      case 'fechar-modal':
        return fecharModal();
      case 'abrir-orc':
        return abrirOrcamento();
      case 'escolher-cliente':
        return abrirEscolhaCliente();
      case 'limpar-cliente':
        selecionarCliente(null);
        return fecharModal();
      case 'novo-cliente':
        return abrirFormCliente(null, estado.vista === 'pedido' ? 'selecionar' : '');
      case 'buscar-cnpj':
        return buscarCnpj();
      case 'salvar-orc': {
        const r = await salvarNoHistorico();
        renderOrcamento();
        return aviso(`Orçamento nº ${r.numero} salvo no histórico`);
      }
      case 'novo-orc':
        return novoOrcamento();
      case 'confirmar': {
        const chave = estado.previa.st ? 'st' : 'tabela44';
        const valor = { ...(estado.previa.st || estado.previa.ds) };
        delete valor.origem;
        aviso('Enviando para o servidor…');
        try {
          await api.chamar('PUT', '/dados/' + chave, { valor }, { timeout: 60000 });
        } catch (e) {
          if (e instanceof api.ErroSessao) return sessaoExpirada(e.message);
          return aviso('Não foi possível enviar: ' + e.message + ' — tente de novo com internet.');
        }
        aplicarDado(chave, valor);
        estado.previa = null;
        if (chave === 'st') {
          renderPainel();
          return aviso('Tabela de ST atualizada para todos');
        }
        indexar();
        renderTopo();
        renderPainel();
        return aviso('Tabela atualizada para todos');
      }
      case 'descartar':
        estado.previa = null;
        return renderPainel();
      case 'sincronizar':
        await sincronizar();
        carregarUsuarios();
        return aviso(estado.erroSync ? 'Falha: ' + estado.erroSync : 'Sincronizado');
      case 'sair':
        if (estado.fila.length && !(await confirmar(`${estado.fila.length} alteração(ões) ainda não foram enviadas e serão perdidas se sair. Sair mesmo assim?`, 'Sair', true))) return;
        if (!(await confirmar('Sair da conta neste aparelho? Os dados locais serão apagados deste aparelho (continuam no servidor).', 'Sair', true))) return;
        await api.sair();
        for (const k of ['clientes', 'historico', 'fila', 'syncDesde', 'ds', 'st', 'ofertas', 'orc']) await db.apagar(k).catch(() => {});
        location.reload();
        return;
      case 'importar-pedidos':
        return importarPedidos();
      case 'descartar-pedidos':
        estado.previaPedidos = null;
        return renderPainel();
      case 'limpar-orc':
        if (!(await confirmar('Tirar todos os itens deste orçamento?', 'Limpar', true))) return;
        Object.assign(estado.orc, { id: null, numero: null, itens: [] });
        estado.pend = {};
        salvarOrc();
        renderBarra();
        fecharFolha();
        if (estado.vista === 'pedido') renderResultados();
        return aviso('Orçamento limpo');
      case 'exportar-backup':
        return exportarBackup();
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.pendInput) {
      const p = porCodigo.get(el.dataset.pendInput);
      const q = multiploEmb(el.value, p.emb);
      if (q !== Number(el.value)) aviso(`Ajustado para ${numero(q)} ${p.um} (múltiplo de ${numero(p.emb)})`);
      estado.pend[p.codigo] = q;
      return atualizarCard(p.codigo);
    }
    if (el.matches('[data-qtd-item]')) {
      const it = estado.orc.itens.find((i) => i.codigo === el.closest('[data-linha]').dataset.linha);
      const p = porCodigo.get(it.codigo);
      const q = multiploEmb(el.value, p.emb);
      if (q !== Number(el.value)) aviso(`Ajustado para ${numero(q)} ${p.um} (múltiplo de ${numero(p.emb)})`);
      it.qtd = q;
      salvarOrc();
      renderBarra();
      return renderOrcamento();
    }
    if (el.dataset.recolheSt !== undefined) {
      estado.orc.recolheSt = el.checked;
      salvarOrc();
      renderBarra();
      renderOrcamento();
      return aviso(el.checked ? 'ST recolhida pelo cliente: não cobrada' : 'ST cobrada no orçamento');
    }
    if (el.id === 'arquivo-pedidos' && el.files.length) return lerPedidos([...el.files]);
    if (el.id === 'arquivo' && el.files[0]) return lerArquivo(el.files[0]);
    if (el.id === 'arquivo-backup' && el.files[0]) return importarBackup(el.files[0]);
    const st = estado.cfg.st;
    if (el.dataset.st) st[el.dataset.st] = Number(el.value) || 0;
    else if (el.dataset.stIpi !== undefined) {
      st.ipiNaBase = el.checked;
      salvarCfg();
      renderPainel();
      return aviso(el.checked ? 'IPI incluído na base da ST' : 'ST sem IPI na base (igual ao %ST da tabela)');
    }
    else if (el.dataset.mva !== undefined) {
      if (el.value === '') delete st.ncms[el.dataset.mva];
      else st.ncms[el.dataset.mva] = { mva: Number(el.value) };
    } else if (el.dataset.semst !== undefined) st.semSt = el.value.split(/[\s,;]+/).filter(Boolean);
    else if (el.dataset.condNome !== undefined || el.dataset.condDesc !== undefined) {
      const lista = condicoes().map((c) => ({ ...c }));
      const i = Number(el.dataset.condNome ?? el.dataset.condDesc);
      if (el.dataset.condNome !== undefined) lista[i].nome = el.value.trim() || lista[i].nome;
      else lista[i].desconto = Math.max(0, Number(el.value) || 0);
      estado.cfg.condicoes = lista;
    } else if (el.dataset.cfg === 'vendedor') {
      estado.cfg.vendedor = el.value.trim();
      if (!estado.orc.itens.length) estado.orc.vendedor = estado.cfg.vendedor;
      api.chamar('PATCH', '/eu', { vendedor: estado.cfg.vendedor }).then((r) => api.guardarSessao(api.token(), r.usuario)).catch(() => {});
      salvarCfgLocal();
      return aviso('Vendedor salvo');
    } else return;
    salvarCfg();
    aviso('Configuração salva');
  });

  // Arrastar arquivo no painel.
  document.addEventListener('dragover', (e) => {
    const up = e.target.closest?.('#upload, #upload-pedidos');
    if (up) {
      e.preventDefault();
      up.classList.add('arrastando');
    }
  });
  document.addEventListener('dragleave', (e) => e.target.closest?.('#upload, #upload-pedidos')?.classList.remove('arrastando'));
  document.addEventListener('drop', (e) => {
    const up = e.target.closest?.('#upload, #upload-pedidos');
    if (!up) return;
    e.preventDefault();
    up.classList.remove('arrastando');
    if (up.id === 'upload-pedidos') return e.dataTransfer.files.length && lerPedidos([...e.dataTransfer.files]);
    if (e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]);
  });

  $('#login-tentar').addEventListener('click', () => (api.token() ? abrirApp() : mostrarLogin()));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').hidden) fecharModal();
    else if (!$('#folha').hidden) fecharFolha();
  });
  window.addEventListener('hashchange', () => irPara(location.hash.slice(1), false));
}

iniciar();
