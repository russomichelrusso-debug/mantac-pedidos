-- Mantac Pedidos: usuários (login Google), sessões, dados compartilhados.
-- Tudo acessado só pela Edge Function "api" (service role); RLS ligado e sem
-- políticas = nenhum acesso direto pela chave pública.

create table if not exists public.usuarios (
  id bigint generated always as identity primary key,
  email text not null unique,
  nome text,
  vendedor text,
  is_admin boolean not null default false,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz
);

create table if not exists public.sessoes (
  token_hash text primary key,
  usuario_id bigint not null references public.usuarios(id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null
);
create index if not exists sessoes_usuario_idx on public.sessoes(usuario_id);

create table if not exists public.clientes (
  id text primary key,
  dados jsonb not null,
  excluido boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por bigint references public.usuarios(id) on delete set null
);
create index if not exists clientes_atualizado_idx on public.clientes(atualizado_em);

create table if not exists public.historico (
  id text primary key,
  dados jsonb not null,
  excluido boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por bigint references public.usuarios(id) on delete set null
);
create index if not exists historico_atualizado_idx on public.historico(atualizado_em);

create table if not exists public.dados (
  chave text primary key,
  valor jsonb not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por bigint references public.usuarios(id) on delete set null
);

create sequence if not exists public.orcamento_seq;

create or replace function public.proximo_orcamento()
returns bigint
language sql
security definer
set search_path = public
as $$ select nextval('public.orcamento_seq') $$;
revoke all on function public.proximo_orcamento() from public, anon, authenticated;

alter table public.usuarios enable row level security;
alter table public.sessoes enable row level security;
alter table public.clientes enable row level security;
alter table public.historico enable row level security;
alter table public.dados enable row level security;
