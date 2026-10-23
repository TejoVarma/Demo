-- Products and orders.
-- Run in the Supabase SQL Editor (or `supabase db push` if using the CLI), then run supabase/seed.sql.

-- Keeps updated_at current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- products (seeded only; no create UI)
-- ---------------------------------------------------------------------------
create table public.products (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) > 0),
  price      numeric(10, 2) not null check (price >= 0),  -- INR
  stock      integer not null default 0 check (stock >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders: one product per order
-- ---------------------------------------------------------------------------
create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  -- Client-generated key per order attempt; a retried/double-submitted request
  -- carries the same key and gets the original order back instead of a new one.
  idempotency_key uuid not null unique,
  -- restrict: a product that appears in orders can't be deleted.
  product_id      uuid not null references public.products (id) on delete restrict,
  quantity        integer not null check (quantity between 1 and 20),
  -- Price at the time of the order, so later price changes don't rewrite history.
  unit_price      numeric(10, 2) not null check (unit_price >= 0),
  total_price     numeric(12, 2) generated always as (quantity * unit_price) stored,
  customer_name   text not null
                  check (length(trim(customer_name)) > 0 and char_length(customer_name) <= 60),
  status          text not null default 'placed' check (status in ('placed', 'cancelled')),
  cancelled_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index orders_created_at_idx on public.orders (created_at desc);
create index orders_product_id_idx on public.orders (product_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Enabled with no policies: the anon/publishable key gets no access at all.
-- The backend uses the secret key, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.orders   enable row level security;

-- ---------------------------------------------------------------------------
-- Order operations
-- supabase-py has no transactions, so stock changes and order writes happen
-- together inside these functions (called via supabase.rpc).
-- Errors use SQLSTATE 'PTxxx', which PostgREST turns into HTTP status xxx;
-- the backend maps them to API responses.
-- ---------------------------------------------------------------------------
-- Returns the order as JSON plus "replayed": true when the idempotency key had
-- already been used for this exact order (nothing new is created in that case).
create or replace function public.place_order(
  p_idempotency_key uuid,
  p_product_id      uuid,
  p_quantity        integer,
  p_customer_name   text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_name  text := trim(p_customer_name);
  v_price numeric(10, 2);
  v_stock integer;
  v_order public.orders;
begin
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required' using errcode = 'PT400';
  end if;

  if p_quantity is null or p_quantity < 1 or p_quantity > 20 then
    raise exception 'Quantity must be a whole number between 1 and 20'
      using errcode = 'PT422';
  end if;

  if v_name is null or v_name = '' or char_length(v_name) > 60 then
    raise exception 'Customer name is required and must be at most 60 characters'
      using errcode = 'PT422';
  end if;

  -- Serialise requests carrying the same key (held until commit), so the check
  -- below sees any order a concurrent duplicate just created.
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 0));

  select * into v_order from orders where idempotency_key = p_idempotency_key;
  if found then
    if v_order.product_id <> p_product_id
       or v_order.quantity <> p_quantity
       or v_order.customer_name <> v_name then
      raise exception 'Idempotency key was already used for a different order'
        using errcode = 'PT422';
    end if;
    return to_jsonb(v_order) || jsonb_build_object('replayed', true);
  end if;

  -- Decrement only if enough stock; the row lock serialises concurrent orders.
  update products
     set stock = stock - p_quantity
   where id = p_product_id
     and stock >= p_quantity
  returning price into v_price;

  if not found then
    select stock into v_stock from products where id = p_product_id;
    if not found then
      raise exception 'Product not found' using errcode = 'PT404';
    end if;
    raise exception 'Insufficient stock: only % left, requested %', v_stock, p_quantity
      using errcode = 'PT409';
  end if;

  -- The unique constraint on idempotency_key is the backstop if the lock is ever bypassed.
  insert into orders (idempotency_key, product_id, quantity, unit_price, customer_name)
  values (p_idempotency_key, p_product_id, p_quantity, v_price, v_name)
  returning * into v_order;

  return to_jsonb(v_order) || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.cancel_order(p_order_id uuid)
returns public.orders
language plpgsql
set search_path = public
as $$
declare
  v_order public.orders;
begin
  -- Only a placed order can move to cancelled; concurrent cancels serialise on the row lock.
  update orders
     set status = 'cancelled',
         cancelled_at = now()
   where id = p_order_id
     and status = 'placed'
  returning * into v_order;

  if not found then
    if exists (select 1 from orders where id = p_order_id) then
      raise exception 'Order is already cancelled' using errcode = 'PT409';
    end if;
    raise exception 'Order not found' using errcode = 'PT404';
  end if;

  update products
     set stock = stock + v_order.quantity
   where id = v_order.product_id;

  return v_order;
end;
$$;

-- Only the backend (service_role) may call these.
revoke execute on function public.place_order(uuid, uuid, integer, text) from public, anon, authenticated;
revoke execute on function public.cancel_order(uuid)               from public, anon, authenticated;
grant  execute on function public.place_order(uuid, uuid, integer, text) to service_role;
grant  execute on function public.cancel_order(uuid)               to service_role;
