-- ==========================================================================
-- SubWatt v2 — Supabase Schema
-- DDL + RLS + audit trigger for the Supabase-backed rate-editor replacement.
-- Run this once in the Supabase SQL Editor after creating the project.
-- ==========================================================================

-- 1. Locals table — replaces the top-level "locals" key in data.json.
--    rate_config stores the full local object (zones, mileageCalc, perDiem, etc.)
--    as JSONB so the admin edit UI still works with structured JSON and we
--    don't need a new column for every rate-structure feature.
create table if not exists locals (
  id            text        primary key,                -- e.g. "7", "36", "82"
  name          text        not null,
  color         text        not null default '#2563eb',
  hall_city     text        default '',
  address       text        default '',
  phone         text        default '',
  bm            text        default '',                  -- business manager
  cba           text        default '',
  jurisdiction  text        default '',
  subs_note     text        default '',
  center        jsonb       default '[0,0]'::jsonb,     -- [lat, lng]
  zoom          numeric     default 7,
  calc_kind     text        default 'zones',             -- zones | zones_cv | mileage
  rate_config   jsonb       not null default '{}'::jsonb,
  -- ^ Full local sub-tree: travelZones, mileageCalc, mileageBrackets,
  --   appendixA, perDiem, hanford, dispatches, etc.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 2. Dispatch points — FK to locals, for search and map rendering.
create table if not exists dispatch_points (
  id        bigint      generated always as identity primary key,
  local_id  text        not null references locals(id) on delete cascade,
  name      text        not null,
  lat       numeric     not null,
  lng       numeric     not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dispatch_points_local_id on dispatch_points(local_id);

-- 3. Audit log — records every UPDATE on locals, written by a trigger.
--    The admin app reads this to show who changed what, when.
create table if not exists audit_log (
  id          bigint      generated always as identity primary key,
  local_id    text        not null references locals(id) on delete cascade,
  changed_by  text        not null default 'admin',     -- could be user email from JWT
  old_data    jsonb       not null,
  new_data    jsonb       not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_audit_log_local_id on audit_log(local_id);
create index if not exists idx_audit_log_created_at on audit_log(created_at desc);

-- 4. Search analytics — the public app INSERTs a row every time someone
--    submits a search. Admins see counts in the admin panel.
create table if not exists search_log (
  id          bigint      generated always as identity primary key,
  query       text        not null,                     -- the user's typed search
  local_id    text        references locals(id),         -- which local was selected (nullable)
  user_agent  text        default '',
  ip_address  text        default '',
  created_at  timestamptz not null default now()
);

create index if not exists idx_search_log_created_at on search_log(created_at desc);
create index if not exists idx_search_log_local_id on search_log(local_id);

-- ==========================================================================
-- RLS — row-level security policies
-- ==========================================================================

alter table locals           enable row level security;
alter table dispatch_points  enable row level security;
alter table audit_log        enable row level security;
alter table search_log       enable row level security;

-- Public read: anyone can read locals + dispatches (they're public rate data)
create policy "Public read — locals"
  on locals for select using (true);

create policy "Public read — dispatch_points"
  on dispatch_points for select using (true);

-- Anonymous insert on search_log (the public app sends search events)
create policy "Anonymous insert — search_log"
  on search_log for insert with check (true);

-- Authenticated-only writes on locals, dispatch_points, audit_log
-- The admin app authenticates via Supabase auth (one hard-coded user).
create policy "Authenticated insert — locals"
  on locals for insert
  to authenticated
  with check (true);

create policy "Authenticated update — locals"
  on locals for update
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated delete — locals"
  on locals for delete
  to authenticated
  using (true);

create policy "Authenticated CRUD — dispatch_points"
  on dispatch_points for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated read — audit_log"
  on audit_log for select
  to authenticated
  using (true);

create policy "Authenticated insert — audit_log"
  on audit_log for insert
  to authenticated
  with check (true);

create policy "Authenticated read — search_log"
  on search_log for select
  to authenticated
  using (true);

-- ==========================================================================
-- Audit trigger — auto-log every UPDATE on locals
-- ==========================================================================

create or replace function log_local_update()
returns trigger as $$
begin
  insert into audit_log (local_id, changed_by, old_data, new_data)
  values (
    old.id,
    coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'admin'),
    to_jsonb(old),
    to_jsonb(new)
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_audit_locals_update on locals;
create trigger trg_audit_locals_update
  after update on locals
  for each row
  execute function log_local_update();

-- ==========================================================================
-- Updated_at trigger
-- ==========================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_locals_updated_at
  before update on locals
  for each row
  execute function set_updated_at();
