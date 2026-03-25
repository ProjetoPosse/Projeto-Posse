create extension if not exists pgcrypto;

create table if not exists public.planos_mensais (
  id uuid primary key default gen_random_uuid(),
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  titulo text not null,
  descricao text,
  mes_referencia date not null,
  status text not null default 'ativo',
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
  dia_semana smallint,
  ordem integer not null default 0,
  tec_url text,
  material_url text,
  concluida boolean not null default false,
  concluida_em timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  mentorado_id uuid not null references public.profiles(id) on delete cascade,
  referencia date not null,
  horas_estudo numeric(6,2) not null default 0,
  questoes_feitas integer not null default 0,
  questoes_certas integer not null default 0,
  pomodoros integer not null default 0,
  metas_cumpridas integer not null default 0,
  observacao text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (mentorado_id, referencia)
);

alter table public.planos_mensais
add column if not exists mentorado_id uuid,
add column if not exists titulo text,
add column if not exists descricao text,
add column if not exists mes_referencia date,
add column if not exists status text default 'ativo',
add column if not exists pdf_url text,
add column if not exists pdf_path text,
add column if not exists created_by uuid,
add column if not exists created_at timestamptz default timezone('utc', now()),
add column if not exists updated_at timestamptz default timezone('utc', now());

alter table public.plano_itens
add column if not exists plano_id uuid,
add column if not exists mentorado_id uuid,
add column if not exists titulo text,
add column if not exists descricao text,
add column if not exists tipo text default 'teoria',
add column if not exists data_prevista date,
add column if not exists dia_semana smallint,
add column if not exists ordem integer default 0,
add column if not exists tec_url text,
add column if not exists material_url text,
add column if not exists concluida boolean default false,
add column if not exists concluida_em timestamptz,
add column if not exists created_at timestamptz default timezone('utc', now()),
add column if not exists updated_at timestamptz default timezone('utc', now());

alter table public.daily_checkins
add column if not exists mentorado_id uuid,
add column if not exists referencia date,
add column if not exists horas_estudo numeric(6,2) default 0,
add column if not exists questoes_feitas integer default 0,
add column if not exists questoes_certas integer default 0,
add column if not exists pomodoros integer default 0,
add column if not exists metas_cumpridas integer default 0,
add column if not exists observacao text,
add column if not exists created_at timestamptz default timezone('utc', now()),
add column if not exists updated_at timestamptz default timezone('utc', now());

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'planos_mensais_mentorado_id_fkey'
  ) then
    alter table public.planos_mensais
    add constraint planos_mensais_mentorado_id_fkey
    foreign key (mentorado_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'planos_mensais_created_by_fkey'
  ) then
    alter table public.planos_mensais
    add constraint planos_mensais_created_by_fkey
    foreign key (created_by) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'plano_itens_plano_id_fkey'
  ) then
    alter table public.plano_itens
    add constraint plano_itens_plano_id_fkey
    foreign key (plano_id) references public.planos_mensais(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'plano_itens_mentorado_id_fkey'
  ) then
    alter table public.plano_itens
    add constraint plano_itens_mentorado_id_fkey
    foreign key (mentorado_id) references public.profiles(id) on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'daily_checkins_mentorado_id_fkey'
  ) then
    alter table public.daily_checkins
    add constraint daily_checkins_mentorado_id_fkey
    foreign key (mentorado_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_planos_mensais_mentorado_ref on public.planos_mensais(mentorado_id, mes_referencia desc);
create index if not exists idx_plano_itens_plano_ordem on public.plano_itens(plano_id, ordem, data_prevista);
create index if not exists idx_plano_itens_mentorado on public.plano_itens(mentorado_id, concluida, data_prevista);
create index if not exists idx_plano_itens_mentorado_done_at on public.plano_itens(mentorado_id, concluida_em desc);
create index if not exists idx_daily_checkins_mentorado_ref on public.daily_checkins(mentorado_id, referencia desc);

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

drop trigger if exists trg_planos_mensais_updated_at on public.planos_mensais;
create trigger trg_planos_mensais_updated_at before update on public.planos_mensais
for each row execute function public.set_updated_at();

drop trigger if exists trg_plano_itens_updated_at on public.plano_itens;
create trigger trg_plano_itens_updated_at before update on public.plano_itens
for each row execute function public.set_updated_at();

drop trigger if exists trg_daily_checkins_updated_at on public.daily_checkins;
create trigger trg_daily_checkins_updated_at before update on public.daily_checkins
for each row execute function public.set_updated_at();

drop trigger if exists trg_plano_item_sync on public.plano_itens;
create trigger trg_plano_item_sync before insert or update on public.plano_itens
for each row execute function public.sync_plano_item_mentorado();

drop trigger if exists trg_plano_item_guard on public.plano_itens;
create trigger trg_plano_item_guard before update on public.plano_itens
for each row execute function public.guard_plano_item_update();

alter table public.planos_mensais enable row level security;
alter table public.plano_itens enable row level security;
alter table public.daily_checkins enable row level security;

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
