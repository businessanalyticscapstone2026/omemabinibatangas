-- Keep deleted follow-up entries as tombstones so automatic yearly generation
-- does not recreate them. No projects or inspection records are removed.
alter table public.annual_validation_entries
  add column if not exists deleted_at timestamptz;
