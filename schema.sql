-- ============================================================================
-- PRINTING PRESS PRODUCTION COST CALCULATOR — database design
-- Scope: production cost only. No customers, quotes, invoices, VAT, profit.
--
-- HOW THE TABLES RELATE (read this first)
--
--   RATE TABLES (you edit these; nothing is hard-coded)        HISTORY TABLES (one job = one calculation)
--   ─────────────────────────────────────────────────         ──────────────────────────────────────────
--   materials ───────────────┐                                  calculations  (1 row per costing)
--   machines  ───────────────┼── referenced by ──►              ├─ calculation_materials   (0..n rows)
--   finishing_operations ────┤                                  ├─ calculation_printing    (exactly 1 row)
--   labor_rates ─────────────┘                                  ├─ calculation_finishing   (0..n rows, in order)
--   settings, waste_defaults  (global defaults)                 ├─ calculation_labor       (0..n rows)
--                                                               └─ calculation_other_costs (0..n rows)
--
--   * Child rows belong to ONE calculation:   ON DELETE CASCADE
--       (delete the calculation → its lines disappear with it)
--   * Child rows point at a rate row:         ON DELETE SET NULL
--       (delete a material later → old calculations still open, because every
--        line also stores a SNAPSHOT of the name and the rate it used)
--   * Money is numeric(14,4). Never float. All sizes are stored in millimetres.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- RATE TABLES ----------------------------------------------------

create table materials (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text not null check (category in ('Paper','Card','Sticker','Vinyl','PVC','Banner','Fabric','Film','Packaging','Other')),
  gsm_thickness  text,
  sheet_width_mm numeric(10,2) check (sheet_width_mm  is null or sheet_width_mm  > 0),
  sheet_height_mm numeric(10,2) check (sheet_height_mm is null or sheet_height_mm > 0),
  roll_width_mm  numeric(10,2) check (roll_width_mm   is null or roll_width_mm   > 0),
  roll_length_m  numeric(10,2) check (roll_length_m   is null or roll_length_m   > 0),
  unit           text not null check (unit in ('sheet','pack','meter','sqm','roll')),  -- what "purchase_cost" is per
  pack_size      integer check (pack_size is null or pack_size >= 1),
  purchase_cost  numeric(14,4) not null check (purchase_cost >= 0),
  min_charge     numeric(14,4) not null default 0 check (min_charge >= 0),
  supplier       text,
  notes          text,
  is_demo        boolean not null default false,
  -- cost_per_sheet / cost_per_meter / cost_per_sqm are DERIVED from purchase_cost + unit + sizes.
  -- Kept as a view (below) so there is one source of truth and they can never disagree.
  check (sheet_width_mm is not null and sheet_height_mm is not null or roll_width_mm is not null)
);

create table machines (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  machine_type         text not null check (machine_type in ('offset','digital','large_format','uv','laminator','guillotine','cutting_plotter','die_cutter','laser')),
  hourly_rate          numeric(14,4) default null check (hourly_rate >= 0),
  setup_rate           numeric(14,4) check (setup_rate >= 0),            -- NULL = use hourly_rate
  speed                numeric(14,4) check (speed is null or speed > 0),  -- impressions/h (offset, digital) or m²/h (large format)
  max_sheet_width_mm   numeric(10,2) check (max_sheet_width_mm > 0),
  max_sheet_height_mm  numeric(10,2) check (max_sheet_height_mm > 0),
  color_units          integer check (color_units is null or color_units >= 1),  -- offset: colours printed per pass
  click_color          numeric(14,4) check (click_color >= 0),            -- digital only
  click_bw             numeric(14,4) check (click_bw >= 0),               -- digital only
  cost_per_impression  numeric(14,4) check (cost_per_impression >= 0),
  cost_per_sqm         numeric(14,4) check (cost_per_sqm >= 0),
  notes                text,
  is_demo              boolean not null default false
);

create table finishing_operations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  pricing_method text not null check (pricing_method in ('per_piece','per_sheet','per_meter','per_sqm','per_hour','fixed')),
  rate           numeric(14,4) check (rate >= 0),
  setup_cost     numeric(14,4) not null default 0 check (setup_cost >= 0),   -- fixed setup cost per job
  min_charge     numeric(14,4) not null default 0 check (min_charge >= 0),
  notes          text,
  is_demo        boolean not null default false
);

create table labor_rates (
  id           uuid primary key default gen_random_uuid(),
  category     text not null,
  hourly_cost  numeric(14,4) not null check (hourly_cost >= 0),
  notes        text,
  is_demo      boolean not null default false
);

create table settings (               -- simple key/value: currency, decimals, plate cost, ink rates, minimums, setup hours
  key    text primary key,
  value  jsonb not null
);

create table waste_defaults (         -- one row per production method
  method       text primary key check (method in ('offset','digital','large_format','sticker')),
  waste_pct    numeric(6,2)  not null default 0 check (waste_pct between 0 and 100),
  setup_waste  numeric(10,3) not null default 0 check (setup_waste >= 0),   -- sheets (sheet jobs) or metres (roll jobs), per run
  min_waste    numeric(10,3) not null default 0 check (min_waste   >= 0)
);

-- ---------- HISTORY TABLES ---------------------------------------------------

create table calculations (
  id              uuid primary key default gen_random_uuid(),
  display_id      text unique not null,                 -- 'PC-0001'
  created_at      timestamptz not null default now(),
  job_name        text not null,
  product_type    text not null,
  production_mode text not null check (production_mode in ('offset','digital','large_format','sticker')),
  quantity        integer not null check (quantity > 0),
  finished_width_mm  numeric(10,2) not null check (finished_width_mm  > 0),
  finished_height_mm numeric(10,2) not null check (finished_height_mm > 0),
  open_width_mm   numeric(10,2) check (open_width_mm  is null or open_width_mm  > 0),
  open_height_mm  numeric(10,2) check (open_height_mm is null or open_height_mm > 0),
  pages           integer check (pages is null or pages >= 0),
  sides           smallint not null default 1 check (sides in (1,2)),
  bleed_mm        numeric(6,2) not null default 0 check (bleed_mm >= 0),
  notes           text,
  -- results, stored so history never changes when rates change later
  subtotal_material  numeric(14,2) not null default 0,
  subtotal_printing  numeric(14,2) not null default 0,
  subtotal_finishing numeric(14,2) not null default 0,
  subtotal_labor     numeric(14,2) not null default 0,
  subtotal_machine   numeric(14,2) not null default 0,
  subtotal_setup     numeric(14,2) not null default 0,
  subtotal_waste     numeric(14,2) not null default 0,
  subtotal_other     numeric(14,2) not null default 0,
  total_cost      numeric(14,2) not null,
  cost_per_piece  numeric(14,6) not null,
  full_result     jsonb                                  -- every line + formula text, for the "Open" view
);

create table calculation_materials (   -- the main material (layout + waste) and any "other material" lines
  id              uuid primary key default gen_random_uuid(),
  calculation_id  uuid not null references calculations(id) on delete cascade,
  material_id     uuid references materials(id) on delete set null,
  role            text not null check (role in ('main','other')),
  material_name   text not null,                          -- snapshot
  layout_kind     text check (layout_kind in ('sheet','roll')),
  press_width_mm  numeric(10,2), press_height_mm numeric(10,2),
  margin_mm numeric(8,2), gripper_mm numeric(8,2), gap_mm numeric(8,2),
  orientation     text check (orientation in ('A','B')),
  pieces_across   integer, pieces_down integer, pieces_per_sheet integer, rows_along_roll integer,
  good_units      numeric(14,4),                          -- sheets or metres needed for good pieces
  waste_units     numeric(14,4),
  total_units     numeric(14,4),
  unit_cost       numeric(14,4) not null,                 -- snapshot of cost per sheet / metre / other unit
  line_cost       numeric(14,2) not null check (line_cost >= 0)
);

create table calculation_printing (    -- exactly one per calculation
  calculation_id  uuid primary key references calculations(id) on delete cascade,
  machine_id      uuid references machines(id) on delete set null,
  machine_name    text not null,                          -- snapshot
  method          text not null check (method in ('offset','digital','area')),
  colours         integer, plates integer, plate_cost numeric(14,4), ink_rate numeric(14,4),
  impressions     numeric(14,2), printed_sqm numeric(14,4),
  click_rate      numeric(14,4), speed_used numeric(14,4),
  run_hours       numeric(10,4), setup_hours numeric(10,4),
  hourly_rate_used numeric(14,4), setup_rate_used numeric(14,4),
  plate_or_click_cost numeric(14,2), ink_cost numeric(14,2), machine_cost numeric(14,2), setup_cost numeric(14,2)
);

create table calculation_finishing (   -- one row per stage, ordered
  id              uuid primary key default gen_random_uuid(),
  calculation_id  uuid not null references calculations(id) on delete cascade,
  stage_no        integer not null,
  operation_id    uuid references finishing_operations(id) on delete set null,
  operation_name  text not null,                          -- snapshot
  pricing_method  text not null,                          -- snapshot
  quantity_basis  numeric(14,4) not null check (quantity_basis >= 0),
  multiplier      numeric(10,4) not null default 1 check (multiplier > 0),
  rate_used       numeric(14,4) not null check (rate_used >= 0),
  min_charge_used numeric(14,4) not null default 0,
  setup_cost_used numeric(14,4) not null default 0,
  run_cost        numeric(14,2) not null,
  setup_cost      numeric(14,2) not null default 0,
  unique (calculation_id, stage_no)
);

create table calculation_labor (
  id              uuid primary key default gen_random_uuid(),
  calculation_id  uuid not null references calculations(id) on delete cascade,
  labor_rate_id   uuid references labor_rates(id) on delete set null,
  category_name   text not null,                          -- snapshot
  hours           numeric(10,3) not null check (hours >= 0),
  hourly_cost_used numeric(14,4) not null check (hourly_cost_used >= 0),
  line_cost       numeric(14,2) not null
);

create table calculation_other_costs (
  id              uuid primary key default gen_random_uuid(),
  calculation_id  uuid not null references calculations(id) on delete cascade,
  description     text not null,
  quantity        numeric(14,4) not null check (quantity >= 0),
  unit_cost       numeric(14,4) not null check (unit_cost >= 0),
  line_cost       numeric(14,2) not null
);

create index on calculations (created_at desc);
create index on calculation_materials (calculation_id);
create index on calculation_finishing (calculation_id, stage_no);
create index on calculation_labor (calculation_id);
create index on calculation_other_costs (calculation_id);

-- ---------- ONE SOURCE OF TRUTH FOR DERIVED MATERIAL COSTS -------------------
create view materials_costed as
select m.*,
  case m.unit when 'sheet' then m.purchase_cost
              when 'pack'  then m.purchase_cost / greatest(m.pack_size,1)
              when 'sqm'   then m.purchase_cost * (m.sheet_width_mm * m.sheet_height_mm / 1e6) end                       as cost_per_sheet,
  case m.unit when 'meter' then m.purchase_cost
              when 'roll'  then m.purchase_cost / nullif(m.roll_length_m,0)
              when 'sqm'   then m.purchase_cost * (m.roll_width_mm / 1000) end                                          as cost_per_meter,
  case m.unit when 'sqm'   then m.purchase_cost
              when 'sheet' then m.purchase_cost / nullif(m.sheet_width_mm * m.sheet_height_mm / 1e6,0)
              when 'pack'  then (m.purchase_cost / greatest(m.pack_size,1)) / nullif(m.sheet_width_mm * m.sheet_height_mm / 1e6,0)
              when 'meter' then m.purchase_cost / nullif(m.roll_width_mm / 1000,0)
              when 'roll'  then (m.purchase_cost / nullif(m.roll_length_m,0)) / nullif(m.roll_width_mm / 1000,0) end    as cost_per_sqm
from materials m;
