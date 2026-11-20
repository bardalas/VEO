-- What a programme from the TV guide is (#487): its genre, its kind, the name and year it is known by, and its picture.
-- Filled by the guide-meta edge function (Claude reads the name and description; IMDb gives the picture), once per
-- programme for the whole household: every device and profile reads the same answer. Anyone may read; only the function
-- writes, and only a signed-in household member makes it ask Claude.
create table if not exists public.guide_meta (
  key        text primary key,          -- the programme's name as the app groups it (providers/guide.js progKey)
  genre      text not null,             -- kids | reality | drama | comedy | news | talk | docu | life | movies | other
  kind       text not null,             -- series | show | film | event | filler
  title      text,                      -- the name it is known by abroad (IMDb's), or its own
  year       int,
  imdb       text,                      -- tt…
  poster     text,                      -- a picture's address
  created_at timestamptz not null default now()
);
alter table public.guide_meta enable row level security;
drop policy if exists "household reads" on public.guide_meta;
drop policy if exists "everyone reads" on public.guide_meta;
create policy "everyone reads" on public.guide_meta for select to anon, authenticated using (true);   -- what a programme is, nothing private

-- The Anthropic key lives in Vault; only the function (service role) may read it.
create or replace function public.anthropic_key() returns text
  language sql security definer set search_path = '' as
$$ select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_api_key' limit 1 $$;
revoke all on function public.anthropic_key() from public, anon, authenticated;
grant execute on function public.anthropic_key() to service_role;
