-- Ranking online de COT · Ruta a la Costa (Supabase / Postgres).
-- Pegar entero en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
-- El juego usa la clave pública "anon" (va en src/rankingConfig.js, se ve en el navegador):
-- con ella solo se puede LEER el ranking y AGREGAR viajes con datos razonables.
-- Nadie puede borrar ni cambiar puntajes desde el juego (no hay permisos de update/delete).

create table if not exists public.ranking (
  id        bigint generated always as identity primary key,
  nombre    text        not null check (char_length(btrim(nombre)) between 1 and 12),
  empresa   text        not null check (empresa in ('cot', 'rutas_del_sol', 'cynsa')),
  puntos    integer     not null check (puntos between 1 and 50000),
  km        numeric(5,1)         check (km between 0 and 400),
  llego     boolean     not null default false,
  creado    timestamptz not null default now()
);

create index if not exists ranking_puntos_idx on public.ranking (puntos desc, creado asc);

alter table public.ranking enable row level security;

drop policy if exists "ranking: leer" on public.ranking;
create policy "ranking: leer" on public.ranking
  for select to anon, authenticated using (true);

drop policy if exists "ranking: agregar" on public.ranking;
create policy "ranking: agregar" on public.ranking
  for insert to anon, authenticated
  with check (creado > now() - interval '1 minute' and creado < now() + interval '1 minute');

-- Solo leer e insertar (sin update ni delete) para el público.
revoke all on public.ranking from anon, authenticated;
grant select, insert on public.ranking to anon, authenticated;
grant usage, select on sequence public.ranking_id_seq to anon, authenticated;

-- Para borrar el ranking (solo desde el panel de Supabase, no desde el juego):
--   truncate public.ranking restart identity;
