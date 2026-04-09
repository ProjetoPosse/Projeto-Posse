create table if not exists public.checkout_orders (
  id uuid primary key default gen_random_uuid(),
  external_reference text not null unique,
  plan_code text,
  plan_title text,
  customer_name text,
  customer_email text,
  customer_phone text,
  concurso_target text,
  amount numeric(10,2),
  currency text not null default 'BRL',
  status text not null default 'pending',
  status_detail text,
  payment_id text unique,
  payment_type text,
  payment_method text,
  installments integer,
  payer_email text,
  approved_at timestamptz,
  last_event_action text,
  last_notification_id bigint,
  raw_payment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.checkout_webhook_events (
  id uuid primary key default gen_random_uuid(),
  notification_id bigint not null unique,
  topic text not null,
  action text,
  resource_id text,
  payment_id text,
  external_reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_checkout_orders_status on public.checkout_orders(status);
create index if not exists idx_checkout_orders_payment_id on public.checkout_orders(payment_id);
create index if not exists idx_checkout_orders_created_at on public.checkout_orders(created_at desc);
create index if not exists idx_checkout_webhook_events_topic on public.checkout_webhook_events(topic);
create index if not exists idx_checkout_webhook_events_payment_id on public.checkout_webhook_events(payment_id);
create index if not exists idx_checkout_webhook_events_created_at on public.checkout_webhook_events(created_at desc);

create or replace function public.set_checkout_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_checkout_orders_updated_at on public.checkout_orders;
create trigger trg_checkout_orders_updated_at
before update on public.checkout_orders
for each row
execute function public.set_checkout_order_updated_at();

alter table public.checkout_orders enable row level security;
alter table public.checkout_webhook_events enable row level security;

drop policy if exists checkout_orders_select on public.checkout_orders;
create policy checkout_orders_select on public.checkout_orders
for select using (public.is_mentor());

drop policy if exists checkout_orders_write_mentor on public.checkout_orders;
create policy checkout_orders_write_mentor on public.checkout_orders
for all using (public.is_mentor()) with check (public.is_mentor());

drop policy if exists checkout_webhook_events_select on public.checkout_webhook_events;
create policy checkout_webhook_events_select on public.checkout_webhook_events
for select using (public.is_mentor());

drop policy if exists checkout_webhook_events_write_mentor on public.checkout_webhook_events;
create policy checkout_webhook_events_write_mentor on public.checkout_webhook_events
for all using (public.is_mentor()) with check (public.is_mentor());

comment on table public.checkout_orders is 'Pedidos do Checkout Pro do Mercado Pago persistidos pelo webhook validado.';
comment on table public.checkout_webhook_events is 'Eventos recebidos do Mercado Pago para auditoria e reprocessamento.';