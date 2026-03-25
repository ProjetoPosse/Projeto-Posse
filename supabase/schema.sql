create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.concursos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cargo text,
  orgao text,
  descricao text,
  status text not null default 'ativo' check (status in ('ativo', 'arquivado')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  nome text,
  role text not null default 'mentorado' check (role in ('mentor', 'mentorado')),
  ativo boolean not null default true,
  concurso_id uuid references public.concursos(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.materiais (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  tipo text,
  visibilidade text not null default 'concurso' check (visibilidade in ('concurso', 'aluno')),
  concurso_id uuid references public.concursos(id) on delete cascade,
  mentorado_id uuid references public.profiles(id) on delete cascade,
  externo_url text,
  file_path text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  created_by uuid references public.profiles(id) on delete set null,
  constraint materiais_alvo_check check (
    (visibilidade = 'concurso' and concurso_id is not null and mentorado_id is null) or
    (visibilidade = 'aluno' and mentorado_id is not null)
  ),
  constraint materiais_fonte_check check (
    externo_url is not null or file_path is not null
  )
);

create table if not exists public.planos_estudo (
  id uuid primary key default gen_random_uuid(),
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  descricao text,
  dia_semana smallint not null default 1 check (dia_semana between 0 and 6),
  ordem integer not null default 0,
  status text not null default 'pendente' check (status in ('pendente', 'em_andamento', 'concluido')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.planos_mensais (
  id uuid primary key default gen_random_uuid(),
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  descricao text,
  mes_referencia date not null,
  status text not null default 'ativo' check (status in ('rascunho', 'ativo', 'arquivado')),
  pdf_url text,
  pdf_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (mentorado_id, mes_referencia)
);

create table if not exists public.plano_itens (
  id uuid primary key default gen_random_uuid(),
  plano_id uuid not null references public.planos_mensais(id) on delete cascade,
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  descricao text,
  tipo text not null default 'teoria',
  data_prevista date,
  dia_semana smallint check (dia_semana between 0 and 6),
  ordem integer not null default 0,
  tec_url text,
  material_url text,
  concluida boolean not null default false,
  concluida_em timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.simulados (
  id uuid primary key default gen_random_uuid(),
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  concurso_id uuid references public.concursos(id) on delete set null,
  titulo text not null,
  data_aplicacao date,
  acertos integer not null default 0 check (acertos >= 0),
  total_questoes integer not null default 0 check (total_questoes >= 0),
  observacoes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.weekly_logs (
  id uuid primary key default gen_random_uuid(),
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  referencia date not null,
  horas numeric(6,2) not null default 0 check (horas >= 0),
  questoes integer not null default 0 check (questoes >= 0),
  acertos integer not null default 0 check (acertos >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (mentorado_id, referencia)
);

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  referencia date not null,
  horas_estudo numeric(6,2) not null default 0 check (horas_estudo >= 0),
  questoes_feitas integer not null default 0 check (questoes_feitas >= 0),
  questoes_certas integer not null default 0 check (questoes_certas >= 0),
  pomodoros integer not null default 0 check (pomodoros >= 0),
  metas_cumpridas integer not null default 0 check (metas_cumpridas >= 0),
  observacao text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (mentorado_id, referencia)
);

create table if not exists public.pomodoro_logs (
  id uuid primary key default gen_random_uuid(),
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  referencia date not null,
  sessoes integer not null default 0 check (sessoes >= 0),
  minutos integer not null default 0 check (minutos >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (mentorado_id, referencia)
);

create index if not exists idx_profiles_role on public.profiles(role);
create index if not exists idx_profiles_concurso on public.profiles(concurso_id);
create index if not exists idx_materiais_concurso on public.materiais(concurso_id);
create index if not exists idx_materiais_mentorado on public.materiais(mentorado_id);
create index if not exists idx_planos_mentorado on public.planos_estudo(mentorado_id, dia_semana, ordem);
create index if not exists idx_planos_mensais_mentorado_ref on public.planos_mensais(mentorado_id, mes_referencia desc);
create index if not exists idx_plano_itens_plano_ordem on public.plano_itens(plano_id, ordem, data_prevista);
create index if not exists idx_plano_itens_mentorado on public.plano_itens(mentorado_id, concluida, data_prevista);
create index if not exists idx_plano_itens_mentorado_done_at on public.plano_itens(mentorado_id, concluida_em desc);
create index if not exists idx_simulados_mentorado_data on public.simulados(mentorado_id, data_aplicacao desc);
create index if not exists idx_daily_checkins_mentorado_ref on public.daily_checkins(mentorado_id, referencia desc);
create index if not exists idx_weekly_logs_mentorado_ref on public.weekly_logs(mentorado_id, referencia desc);
create index if not exists idx_pomodoro_logs_mentorado_ref on public.pomodoro_logs(mentorado_id, referencia desc);

drop trigger if exists trg_concursos_updated_at on public.concursos;
create trigger trg_concursos_updated_at before update on public.concursos for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists trg_materiais_updated_at on public.materiais;
create trigger trg_materiais_updated_at before update on public.materiais for each row execute function public.set_updated_at();

drop trigger if exists trg_planos_estudo_updated_at on public.planos_estudo;
create trigger trg_planos_estudo_updated_at before update on public.planos_estudo for each row execute function public.set_updated_at();

drop trigger if exists trg_planos_mensais_updated_at on public.planos_mensais;
create trigger trg_planos_mensais_updated_at before update on public.planos_mensais for each row execute function public.set_updated_at();

drop trigger if exists trg_plano_itens_updated_at on public.plano_itens;
create trigger trg_plano_itens_updated_at before update on public.plano_itens for each row execute function public.set_updated_at();

drop trigger if exists trg_simulados_updated_at on public.simulados;
create trigger trg_simulados_updated_at before update on public.simulados for each row execute function public.set_updated_at();

drop trigger if exists trg_weekly_logs_updated_at on public.weekly_logs;
create trigger trg_weekly_logs_updated_at before update on public.weekly_logs for each row execute function public.set_updated_at();

drop trigger if exists trg_daily_checkins_updated_at on public.daily_checkins;
create trigger trg_daily_checkins_updated_at before update on public.daily_checkins for each row execute function public.set_updated_at();

drop trigger if exists trg_pomodoro_logs_updated_at on public.pomodoro_logs;
create trigger trg_pomodoro_logs_updated_at before update on public.pomodoro_logs for each row execute function public.set_updated_at();

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_mentor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'mentor', false)
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nome, role, ativo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'role', 'mentorado'),
    true
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.sync_plano_item_mentorado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select mentorado_id into new.mentorado_id
  from public.planos_mensais
  where id = new.plano_id;

  if new.mentorado_id is null then
    raise exception 'Plano mensal invalido para este item.';
  end if;

  if new.concluida = false then
    new.concluida_em = null;
  elsif new.concluida = true and new.concluida_em is null then
    new.concluida_em = timezone('utc', now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_plano_item_sync on public.plano_itens;
create trigger trg_plano_item_sync
before insert or update on public.plano_itens
for each row execute function public.sync_plano_item_mentorado();

create or replace function public.guard_plano_item_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_mentor() then
    return new;
  end if;

  if auth.uid() is distinct from old.mentorado_id then
    raise exception 'Sem permissao para alterar esta meta.';
  end if;

  if new.plano_id is distinct from old.plano_id
    or new.mentorado_id is distinct from old.mentorado_id
    or new.titulo is distinct from old.titulo
    or new.descricao is distinct from old.descricao
    or new.tipo is distinct from old.tipo
    or new.data_prevista is distinct from old.data_prevista
    or new.dia_semana is distinct from old.dia_semana
    or new.ordem is distinct from old.ordem
    or new.tec_url is distinct from old.tec_url
    or new.material_url is distinct from old.material_url
  then
    raise exception 'O mentorado so pode marcar a meta como concluida.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_plano_item_guard on public.plano_itens;
create trigger trg_plano_item_guard
before update on public.plano_itens
for each row execute function public.guard_plano_item_update();

alter table public.concursos enable row level security;
alter table public.profiles enable row level security;
alter table public.materiais enable row level security;
alter table public.planos_estudo enable row level security;
alter table public.planos_mensais enable row level security;
alter table public.plano_itens enable row level security;
alter table public.simulados enable row level security;
alter table public.daily_checkins enable row level security;
alter table public.weekly_logs enable row level security;
alter table public.pomodoro_logs enable row level security;

drop policy if exists concursos_select on public.concursos;
create policy concursos_select on public.concursos
for select using (
  public.is_mentor()
  or id = (select concurso_id from public.profiles where id = auth.uid())
);

drop policy if exists concursos_write on public.concursos;
create policy concursos_write on public.concursos
for all using (public.is_mentor()) with check (public.is_mentor());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select using (public.is_mentor() or id = auth.uid());

drop policy if exists profiles_update_mentor on public.profiles;
create policy profiles_update_mentor on public.profiles
for update using (public.is_mentor()) with check (public.is_mentor());

drop policy if exists materiais_select on public.materiais;
create policy materiais_select on public.materiais
for select using (
  public.is_mentor()
  or (
    (visibilidade = 'aluno' and mentorado_id = auth.uid())
    or (
      visibilidade = 'concurso'
      and concurso_id = (select concurso_id from public.profiles where id = auth.uid())
    )
  )
);

drop policy if exists materiais_write on public.materiais;
create policy materiais_write on public.materiais
for all using (public.is_mentor()) with check (public.is_mentor());

drop policy if exists planos_select on public.planos_estudo;
create policy planos_select on public.planos_estudo
for select using (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists planos_write on public.planos_estudo;
create policy planos_write on public.planos_estudo
for all using (public.is_mentor()) with check (public.is_mentor());

drop policy if exists planos_mensais_select on public.planos_mensais;
create policy planos_mensais_select on public.planos_mensais
for select using (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists planos_mensais_write on public.planos_mensais;
create policy planos_mensais_write on public.planos_mensais
for all using (public.is_mentor()) with check (public.is_mentor());

drop policy if exists plano_itens_select on public.plano_itens;
create policy plano_itens_select on public.plano_itens
for select using (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists plano_itens_insert on public.plano_itens;
create policy plano_itens_insert on public.plano_itens
for insert with check (public.is_mentor());

drop policy if exists plano_itens_update on public.plano_itens;
create policy plano_itens_update on public.plano_itens
for update using (public.is_mentor() or mentorado_id = auth.uid())
with check (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists plano_itens_delete on public.plano_itens;
create policy plano_itens_delete on public.plano_itens
for delete using (public.is_mentor());

drop policy if exists simulados_select on public.simulados;
create policy simulados_select on public.simulados
for select using (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists simulados_write on public.simulados;
create policy simulados_write on public.simulados
for all using (public.is_mentor()) with check (public.is_mentor());

drop policy if exists daily_checkins_select on public.daily_checkins;
create policy daily_checkins_select on public.daily_checkins
for select using (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists daily_checkins_insert on public.daily_checkins;
create policy daily_checkins_insert on public.daily_checkins
for insert with check (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists daily_checkins_update on public.daily_checkins;
create policy daily_checkins_update on public.daily_checkins
for update using (public.is_mentor() or mentorado_id = auth.uid())
with check (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists weekly_logs_select on public.weekly_logs;
create policy weekly_logs_select on public.weekly_logs
for select using (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists weekly_logs_insert on public.weekly_logs;
create policy weekly_logs_insert on public.weekly_logs
for insert with check (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists weekly_logs_update on public.weekly_logs;
create policy weekly_logs_update on public.weekly_logs
for update using (public.is_mentor() or mentorado_id = auth.uid())
with check (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists pomodoro_logs_select on public.pomodoro_logs;
create policy pomodoro_logs_select on public.pomodoro_logs
for select using (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists pomodoro_logs_insert on public.pomodoro_logs;
create policy pomodoro_logs_insert on public.pomodoro_logs
for insert with check (public.is_mentor() or mentorado_id = auth.uid());

drop policy if exists pomodoro_logs_update on public.pomodoro_logs;
create policy pomodoro_logs_update on public.pomodoro_logs
for update using (public.is_mentor() or mentorado_id = auth.uid())
with check (public.is_mentor() or mentorado_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('materiais', 'materiais', false)
on conflict (id) do nothing;

drop policy if exists materiais_bucket_select on storage.objects;
create policy materiais_bucket_select on storage.objects
for select using (
  bucket_id = 'materiais'
  and (
    public.is_mentor()
    or exists (
      select 1
      from public.materiais m
      join public.profiles p on p.id = auth.uid()
      where m.file_path = name
        and (
          (m.visibilidade = 'aluno' and m.mentorado_id = auth.uid())
          or (m.visibilidade = 'concurso' and m.concurso_id = p.concurso_id)
        )
    )
  )
);

drop policy if exists materiais_bucket_insert on storage.objects;
create policy materiais_bucket_insert on storage.objects
for insert with check (bucket_id = 'materiais' and public.is_mentor());

drop policy if exists materiais_bucket_update on storage.objects;
create policy materiais_bucket_update on storage.objects
for update using (bucket_id = 'materiais' and public.is_mentor())
with check (bucket_id = 'materiais' and public.is_mentor());

drop policy if exists materiais_bucket_delete on storage.objects;
create policy materiais_bucket_delete on storage.objects
for delete using (bucket_id = 'materiais' and public.is_mentor());

comment on table public.profiles is 'Fonte unica para role e isolamento de acesso. A interface deve confiar neste campo, nunca em user_metadata.';
comment on table public.materiais is 'Material por concurso ou por aluno, protegido por RLS e opcionalmente por storage privado.';
comment on table public.planos_mensais is 'Plano mensal individual do mentorado, com PDF opcional e vigencia por mes.';
comment on table public.plano_itens is 'Metas individualizadas do plano mensal com link do TEC e conclusao pelo proprio aluno.';
comment on table public.daily_checkins is 'Registro diario do aluno para horas, questoes, acertos, pomodoros e metas cumpridas.';
comment on function public.is_mentor() is 'Usada nas RLS para centralizar a regra de acesso administrativo.';
