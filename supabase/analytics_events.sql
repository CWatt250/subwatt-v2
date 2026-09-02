-- 5. Usage analytics — one row per visit (kind='visit', once per browser
--    session) and one per feature event. Geo/device columns are denormalised
--    onto every row so the admin panel can aggregate with plain selects.
--    No IP addresses are stored; city/region come from a client-side lookup.
--    Applied to prod 2026-09-02 via `supabase db query --linked -f`.
create table if not exists analytics_events (
  id          bigint      generated always as identity primary key,
  created_at  timestamptz not null default now(),
  session_id  text        not null,                 -- random per browser session
  kind        text        not null,                 -- visit | county_click | search | pdf_export | basemap | irex
  label       text        default '',               -- county name / search text / 'sat' ...
  local_id    text        default '',               -- local in context, if any
  country     text        default '',
  region      text        default '',               -- state / province
  city        text        default '',
  lat         double precision,
  lng         double precision,                     -- city-level only
  device      text        default '',               -- desktop | mobile | tablet
  browser     text        default '',
  os          text        default '',
  screen      text        default '',               -- e.g. 1512x982
  referrer    text        default '',               -- referring hostname
  path        text        default '',
  user_agent  text        default '',
  is_pwa      boolean     default false
);
create index if not exists idx_analytics_events_created_at on analytics_events(created_at desc);
create index if not exists idx_analytics_events_kind       on analytics_events(kind, created_at desc);
create index if not exists idx_analytics_events_session    on analytics_events(session_id);

alter table analytics_events enable row level security;

drop policy if exists "Anonymous insert — analytics_events" on analytics_events;
create policy "Anonymous insert — analytics_events"
  on analytics_events for insert with check (true);

drop policy if exists "Authenticated read — analytics_events" on analytics_events;
create policy "Authenticated read — analytics_events"
  on analytics_events for select to authenticated using (true);

drop policy if exists "Authenticated delete — analytics_events" on analytics_events;
create policy "Authenticated delete — analytics_events"
  on analytics_events for delete to authenticated using (true);

grant insert on analytics_events to anon;
grant select, delete on analytics_events to authenticated;
