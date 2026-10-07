-- Run once in the existing Supabase project SQL editor before using equipment import.
-- Adds capacity fields and permits unconfirmed rates; existing values are preserved.
begin;
alter table public.machines add column if not exists max_sheet_width_mm numeric(10,2) check (max_sheet_width_mm > 0);
alter table public.machines add column if not exists max_sheet_height_mm numeric(10,2) check (max_sheet_height_mm > 0);
alter table public.machines alter column hourly_rate drop not null;
alter table public.machines alter column hourly_rate drop default;
alter table public.finishing_operations alter column rate drop not null;
commit;
notify pgrst, 'reload schema';
