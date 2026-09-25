// Comunicação com o servidor (Supabase Edge Function "api") e login Google.
export const API = 'https://bqzrzpbpactbxmkhyjle.supabase.co/functions/v1/api';
// Mesmo Client ID do app de vendas (mesma origem russomichelrusso-debug.github.io).
export const GOOGLE_CLIENT_ID = '587215783588-g9nrt4mq8onu12qkj4r8h4ao307478i4.apps.googleusercontent.com';

const CHAVE_TOKEN = 'mantacToken_v1';
const CHAVE_USUARIO = 'mantacUsuario_v1';

const ler = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const gravar = (k, v) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch { /* sem localStorage: sessão só em memória */ }
};

let tokenMem = ler(CHAVE_TOKEN);
export const token = () => tokenMem;
export function usuario() {
  try {
    return JSON.parse(ler(CHAVE_USUARIO) || 'null');
  } catch {
    return null;
  }
}
export function guardarSessao(t, u) {
  tokenMem = t;
  gravar(CHAVE_TOKEN, t);
  gravar(CHAVE_USUARIO, u ? JSON.stringify(u) : null);
}

export class ErroSessao extends Error {}
export class ErroRede extends Error {}

/** Chamada à API. Lança ErroSessao (401), ErroRede (sem conexão) ou Error (mensagem do servidor). */
export async function chamar(metodo, caminho, corpo, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    r = await fetch(API + caminho, {
      method: metodo,
      headers: { ...(tokenMem ? { Authorization: 'Bearer ' + tokenMem } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ErroRede('Sem conexão com o servidor.');
  } finally {
    clearTimeout(t);
  }
  let dados = null;
  try {
    dados = await r.json();
  } catch { /* resposta sem corpo */ }
  if (r.status === 401) throw new ErroSessao(dados?.erro || 'Faça login novamente.');
  if (!r.ok) throw new Error(dados?.erro || `Erro ${r.status} no servidor.`);
  return dados;
}

let gsi;
function carregarGoogle() {
  gsi ||= new Promise((ok, erro) => {
    if (window.google?.accounts?.id) return ok();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = ok;
    s.onerror = () => {
      gsi = null;
      erro(new Error('Não consegui carregar o login do Google — confira a internet.'));
    };
    document.head.append(s);
  });
  return gsi;
}

/** Desenha o botão "Entrar com Google" em `el`; chama `aoEntrar(usuario)` após o login. */
export async function botaoGoogle(el, aoEntrar, aoErro) {
  await carregarGoogle();
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: async ({ credential }) => {
      try {
        const r = await chamar('POST', '/auth/google', { credential });
        guardarSessao(r.token, r.usuario);
        aoEntrar(r.usuario);
      } catch (e) {
        aoErro(e);
      }
    },
  });
  window.google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', shape: 'rectangular', text: 'signin_with', locale: 'pt-BR', width: 280 });
}

export async function sair() {
  try {
    await chamar('POST', '/auth/logout');
  } catch { /* sai localmente mesmo sem servidor */ }
  guardarSessao(null, null);
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch { /* ignore */ }
}
