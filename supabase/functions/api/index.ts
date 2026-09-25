// API do Mantac Pedidos (Supabase Edge Function "api").
//
// Login com Google (mesmo Client ID do app de vendas no mesmo domínio): o app
// manda o ID token, conferimos no Google e devolvemos um token de sessão
// opaco (guardado só como hash). Todo o resto exige "Authorization: Bearer".
// Os dados ficam em tabelas com RLS sem políticas: só esta função (service
// role) acessa.
//
// Rotas (prefixo /api):
//   POST /auth/google {credential}      GET /auth/me      POST /auth/logout
//   GET/POST /usuarios · PATCH/DELETE /usuarios/:id     (admin)
//   GET /sync?desde=ISO                 → clientes, histórico e dados alterados
//   PUT/DELETE /clientes/:id · PUT/DELETE /historico/:id
//   POST /historico/numero              → próximo nº de orçamento
//   PUT /dados/:chave (tabela44 | st | ofertas | config)
import { createClient } from 'npm:@supabase/supabase-js@2';

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '587215783588-g9nrt4mq8onu12qkj4r8h4ao307478i4.apps.googleusercontent.com';
const ORIGENS = ['https://russomichelrusso-debug.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const CHAVES_DADOS = ['tabela44', 'st', 'ofertas', 'config'];
const SESSAO_DIAS = 90;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

class ErroHttp extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

function cors(req: Request): Record<string, string> {
  const origem = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGENS.includes(origem) ? origem : ORIGENS[0],
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (req: Request, corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });

async function sha256(txt: string) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function novoToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function checar<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) {
    console.error(r.error);
    throw new ErroHttp(500, 'Erro no banco de dados.');
  }
  return r.data;
}

async function verificarGoogle(credential: unknown) {
  if (typeof credential !== 'string' || credential.length > 4096) return null;
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (d.aud !== GOOGLE_CLIENT_ID || !d.email || d.email_verified !== 'true') return null;
  return { email: String(d.email).toLowerCase(), nome: String(d.name || d.email) };
}

type Usuario = { id: number; email: string; nome: string | null; vendedor: string | null; is_admin: boolean; ativo: boolean };

async function usuarioDaSessao(req: Request): Promise<Usuario> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length > 200) throw new ErroHttp(401, 'Faça login novamente.');
  const s = checar(
    await db.from('sessoes').select('usuario_id, expira_em, usuarios(id,email,nome,vendedor,is_admin,ativo)').eq('token_hash', await sha256(token)).maybeSingle(),
  ) as { expira_em: string; usuarios: Usuario } | null;
  if (!s || new Date(s.expira_em) < new Date() || !s.usuarios?.ativo) throw new ErroHttp(401, 'Sessão expirada — faça login novamente.');
  return s.usuarios;
}

const publico = (u: Usuario) => ({ id: u.id, email: u.email, nome: u.nome, vendedor: u.vendedor, is_admin: u.is_admin });

async function lerCorpo(req: Request) {
  const txt = await req.text();
  if (txt.length > 5_000_000) throw new ErroHttp(413, 'Envio grande demais.');
  try {
    return txt ? JSON.parse(txt) : {};
  } catch {
    throw new ErroHttp(400, 'JSON inválido.');
  }
}

const idValido = (id: string) => /^[\w.-]{1,80}$/.test(id);

async function rotear(req: Request, caminho: string[], url: URL): Promise<Response> {
  const [recurso, id, extra] = caminho;
  const m = req.method;

  if (recurso === 'health') return json(req, { status: 'ok' });

  if (recurso === 'auth' && id === 'google' && m === 'POST') {
    const { credential } = await lerCorpo(req);
    const g = await verificarGoogle(credential);
    if (!g) throw new ErroHttp(401, 'Não foi possível confirmar o login com o Google.');
    let u = checar(await db.from('usuarios').select('*').eq('email', g.email).maybeSingle()) as Usuario | null;
    if (!u) {
      const { count } = await db.from('usuarios').select('id', { count: 'exact', head: true });
      if ((count ?? 0) > 0) throw new ErroHttp(403, `O e-mail ${g.email} não está autorizado. Peça ao administrador para cadastrá-lo no Painel.`);
      // Primeiro acesso do sistema: vira administrador.
      u = checar(await db.from('usuarios').insert({ email: g.email, nome: g.nome, is_admin: true }).select('*').single()) as Usuario;
    }
    if (!u.ativo) throw new ErroHttp(403, 'Usuário desativado.');
    const token = novoToken();
    const expira = new Date(Date.now() + SESSAO_DIAS * 864e5).toISOString();
    checar(await db.from('sessoes').insert({ token_hash: await sha256(token), usuario_id: u.id, expira_em: expira }));
    await db.from('usuarios').update({ ultimo_acesso: new Date().toISOString(), nome: u.nome || g.nome }).eq('id', u.id);
    await db.from('sessoes').delete().lt('expira_em', new Date().toISOString());
    return json(req, { token, usuario: publico(u) });
  }

  const u = await usuarioDaSessao(req);

  if (recurso === 'auth' && id === 'me') return json(req, { usuario: publico(u) });
  if (recurso === 'auth' && id === 'logout' && m === 'POST') {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    await db.from('sessoes').delete().eq('token_hash', await sha256(token));
    return json(req, { ok: true });
  }

  if (recurso === 'usuarios') {
    if (!u.is_admin) throw new ErroHttp(403, 'Só o administrador gerencia usuários.');
    if (m === 'GET') return json(req, checar(await db.from('usuarios').select('id,email,nome,vendedor,is_admin,ativo,ultimo_acesso').order('nome')));
    if (m === 'POST') {
      const b = await lerCorpo(req);
      const email = String(b.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErroHttp(400, 'E-mail inválido.');
      const r = await db.from('usuarios').insert({ email, nome: String(b.nome ?? '').trim() || null, vendedor: String(b.vendedor ?? '').trim() || null, is_admin: !!b.is_admin }).select('*').single();
      if (r.error?.code === '23505') throw new ErroHttp(409, 'Esse e-mail já está cadastrado.');
      return json(req, checar(r));
    }
    const alvo = Number(id);
    if (!alvo) throw new ErroHttp(400, 'Usuário inválido.');
    if (m === 'PATCH') {
      const b = await lerCorpo(req);
      const campos: Record<string, unknown> = {};
      for (const k of ['nome', 'vendedor']) if (k in b) campos[k] = String(b[k] ?? '').trim() || null;
      for (const k of ['is_admin', 'ativo']) if (k in b) campos[k] = !!b[k];
      if (alvo === u.id && (campos.is_admin === false || campos.ativo === false)) throw new ErroHttp(400, 'Você não pode tirar o próprio acesso de administrador.');
      return json(req, checar(await db.from('usuarios').update(campos).eq('id', alvo).select('*').single()));
    }
    if (m === 'DELETE') {
      if (alvo === u.id) throw new ErroHttp(400, 'Você não pode excluir o próprio usuário.');
      checar(await db.from('usuarios').delete().eq('id', alvo));
      return json(req, { ok: true });
    }
  }

  // O próprio usuário pode ajustar o nome de vendedor.
  if (recurso === 'eu' && m === 'PATCH') {
    const b = await lerCorpo(req);
    const r = checar(await db.from('usuarios').update({ vendedor: String(b.vendedor ?? '').trim() || null }).eq('id', u.id).select('*').single()) as Usuario;
    return json(req, { usuario: publico(r) });
  }

  if (recurso === 'sync' && m === 'GET') {
    const desde = url.searchParams.get('desde');
    const agora = new Date().toISOString();
    // deno-lint-ignore no-explicit-any
    const filtro = (q: any) => (desde ? q.gt('atualizado_em', desde) : q);
    const [clientes, historico, dados] = await Promise.all([
      filtro(db.from('clientes').select('id,dados,excluido,atualizado_em')),
      filtro(db.from('historico').select('id,dados,excluido,atualizado_em')),
      filtro(db.from('dados').select('chave,valor,atualizado_em')),
    ]);
    return json(req, { agora, clientes: checar(clientes), historico: checar(historico), dados: checar(dados) });
  }

  if (recurso === 'historico' && id === 'numero' && m === 'POST') {
    const n = checar(await db.rpc('proximo_orcamento'));
    return json(req, { numero: Number(n) });
  }

  if ((recurso === 'clientes' || recurso === 'historico') && id && !extra) {
    if (!idValido(id)) throw new ErroHttp(400, 'Identificador inválido.');
    const agora = new Date().toISOString();
    if (m === 'PUT') {
      const { dados } = await lerCorpo(req);
      if (!dados || typeof dados !== 'object') throw new ErroHttp(400, 'Dados ausentes.');
      checar(await db.from(recurso).upsert({ id, dados: { ...dados, id }, excluido: false, atualizado_em: agora, atualizado_por: u.id }));
      return json(req, { ok: true, atualizado_em: agora });
    }
    if (m === 'DELETE') {
      checar(await db.from(recurso).upsert({ id, dados: { id }, excluido: true, atualizado_em: agora, atualizado_por: u.id }));
      return json(req, { ok: true, atualizado_em: agora });
    }
  }

  if (recurso === 'dados' && id && m === 'PUT') {
    if (!CHAVES_DADOS.includes(id)) throw new ErroHttp(400, 'Conjunto de dados desconhecido.');
    const { valor } = await lerCorpo(req);
    if (!valor || typeof valor !== 'object') throw new ErroHttp(400, 'Valor ausente.');
    const agora = new Date().toISOString();
    checar(await db.from('dados').upsert({ chave: id, valor, atualizado_em: agora, atualizado_por: u.id }));
    return json(req, { ok: true, atualizado_em: agora });
  }

  throw new ErroHttp(404, 'Rota não encontrada.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const url = new URL(req.url);
  // /functions/v1/api/<rota...>  (em produção o prefixo chega como /api/...)
  const partes = url.pathname.split('/').filter(Boolean);
  const i = partes.indexOf('api');
  const caminho = (i >= 0 ? partes.slice(i + 1) : partes).map(decodeURIComponent);
  try {
    return await rotear(req, caminho, url);
  } catch (e) {
    if (e instanceof ErroHttp) return json(req, { erro: e.message }, e.status);
    console.error(e);
    return json(req, { erro: 'Erro interno.' }, 500);
  }
});
