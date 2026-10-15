-- Talento NFQ · esquema inicial
-- Datos compartidos de la app: miembros con rol, fuentes de Drive, necesidades,
-- ofertas, funnel y pool, con auditoría de cada cambio.
-- Las hojas de Recruiting NO se copian aquí: se leen en el navegador de cada
-- usuario con su propio permiso de Drive. Las personas se identifican con una
-- clave cifrada (pkey), nunca con email, teléfono ni LinkedIn.

-- ---------------------------------------------------------------------------
-- Miembros y roles
-- ---------------------------------------------------------------------------
create table public.miembros (
  email      text primary key
             check (email = lower(email) and email ~ '^[a-z0-9._%+-]+@nfq\.es$'),
  nombre     text check (char_length(nombre) <= 120),
  rol        text not null default 'lector' check (rol in ('admin', 'editor', 'lector')),
  ug         text not null default 'UG02' check (char_length(ug) <= 40),
  creado     timestamptz not null default now(),
  creado_por text
);
comment on table public.miembros is 'Quién puede entrar y con qué rol. Solo cuentas @nfq.es.';

-- Email del usuario autenticado, en minúsculas ('' si no hay sesión).
create or replace function public.mi_email() returns text
language sql stable
as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

-- Rol del usuario autenticado (null si no es miembro o no es @nfq.es).
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public
as $$
  select m.rol from public.miembros m
  where m.email = public.mi_email() and public.mi_email() ~ '@nfq\.es$'
$$;

create or replace function public.puede_leer() returns boolean
language sql stable as $$ select public.mi_rol() is not null $$;
create or replace function public.puede_editar() returns boolean
language sql stable as $$ select coalesce(public.mi_rol() in ('admin', 'editor'), false) $$;
create or replace function public.es_admin() returns boolean
language sql stable as $$ select coalesce(public.mi_rol() = 'admin', false) $$;

-- Siempre debe quedar al menos un administrador.
create or replace function public.miembros_guardar_admin() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (tg_op = 'DELETE' and old.rol = 'admin')
     or (tg_op = 'UPDATE' and old.rol = 'admin' and new.rol <> 'admin') then
    if (select count(*) from public.miembros where rol = 'admin' and email <> old.email) = 0 then
      raise exception 'Debe quedar al menos un administrador';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger miembros_guardar_admin before update or delete on public.miembros
  for each row execute function public.miembros_guardar_admin();

create or replace function public.miembros_autor() returns trigger
language plpgsql as $$
begin
  new.creado_por := public.mi_email();
  return new;
end $$;
create trigger miembros_autor before insert on public.miembros
  for each row execute function public.miembros_autor();

alter table public.miembros enable row level security;
create policy miembros_leer on public.miembros for select to authenticated using (public.puede_leer());
create policy miembros_alta on public.miembros for insert to authenticated with check (public.es_admin());
create policy miembros_cambio on public.miembros for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy miembros_baja on public.miembros for delete to authenticated using (public.es_admin());

-- ---------------------------------------------------------------------------
-- Documentos compartidos (mismo formato en todas las tablas)
-- ---------------------------------------------------------------------------
create or replace function public.doc_autor() returns trigger
language plpgsql as $$
begin
  new.actualizado := now();
  new.actualizado_por := public.mi_email();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['fuentes', 'necesidades', 'ofertas', 'funnel', 'pool'] loop
    execute format($f$
      create table public.%1$I (
        id              text primary key check (id ~ '^[A-Za-z0-9_\-.~:@+]{1,200}$'),
        ug              text not null default 'UG02',
        data            jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 262144),
        actualizado     timestamptz not null default now(),
        actualizado_por text
      );
      create trigger %1$s_autor before insert or update on public.%1$I
        for each row execute function public.doc_autor();
      alter table public.%1$I enable row level security;
      create policy %1$s_leer on public.%1$I for select to authenticated using (public.puede_leer());
    $f$, t);
  end loop;
end $$;

-- Necesidades, ofertas, funnel y pool: editan editores y administradores.
do $$
declare t text;
begin
  foreach t in array array['necesidades', 'ofertas', 'funnel', 'pool'] loop
    execute format($f$
      create policy %1$s_alta   on public.%1$I for insert to authenticated with check (public.puede_editar());
      create policy %1$s_cambio on public.%1$I for update to authenticated using (public.puede_editar()) with check (public.puede_editar());
      create policy %1$s_baja   on public.%1$I for delete to authenticated using (public.puede_editar());
    $f$, t);
  end loop;
end $$;

-- Fuentes (qué hojas de Drive se leen): solo administradores.
create policy fuentes_alta   on public.fuentes for insert to authenticated with check (public.es_admin());
create policy fuentes_cambio on public.fuentes for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy fuentes_baja   on public.fuentes for delete to authenticated using (public.es_admin());

create index funnel_need_idx on public.funnel ((data ->> 'need'));
create index funnel_pkey_idx on public.funnel ((data ->> 'pkey'));
create index ofertas_need_idx on public.ofertas ((data ->> 'necesidad'));

-- ---------------------------------------------------------------------------
-- Auditoría: quién cambió qué y cuándo (solo la leen administradores)
-- ---------------------------------------------------------------------------
create table public.auditoria (
  id      bigint generated always as identity primary key,
  tabla   text not null,
  doc_id  text not null,
  accion  text not null check (accion in ('alta', 'cambio', 'baja')),
  por     text,
  cuando  timestamptz not null default now(),
  antes   jsonb,
  despues jsonb
);
create index auditoria_cuando_idx on public.auditoria (cuando desc);
alter table public.auditoria enable row level security;
create policy auditoria_leer on public.auditoria for select to authenticated using (public.es_admin());

create or replace function public.auditar() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.auditoria (tabla, doc_id, accion, por, antes, despues)
  values (
    tg_table_name,
    coalesce(new.id, old.id),
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'baja' end,
    public.mi_email(),
    case when tg_op in ('UPDATE', 'DELETE') then old.data end,
    case when tg_op in ('INSERT', 'UPDATE') then new.data end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['fuentes', 'necesidades', 'ofertas', 'funnel', 'pool'] loop
    execute format('create trigger %1$s_auditar after insert or update or delete on public.%1$I for each row execute function public.auditar()', t);
  end loop;
end $$;

create or replace function public.auditar_miembros() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.auditoria (tabla, doc_id, accion, por, antes, despues)
  values ('miembros', coalesce(new.email, old.email),
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'baja' end,
    public.mi_email(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger miembros_auditar after insert or update or delete on public.miembros
  for each row execute function public.auditar_miembros();

-- ---------------------------------------------------------------------------
-- Tiempo real para que el equipo vea los cambios al momento
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.miembros, public.fuentes, public.necesidades, public.ofertas, public.funnel, public.pool;
  end if;
end $$;

-- Configuración inicial de la UG 02 (BBVA). Ajustable después desde la app.
insert into public.fuentes (id, ug, data) values ('UG02', 'UG02', jsonb_build_object(
  'base', jsonb_build_object('id', '1vl6gUv61mpeEDCwqU5Bsgi5CyJXI3upDYeGsGNdRA2Y', 'name', 'Recruiting-Sr Seguros/ Data / IA'),
  'clients', jsonb_build_array(jsonb_build_object('id', '1B3GFedS6c1ZY0lMYW4zqTqVgLbmTz-S-_0F0o4sS7bY', 'name', 'Recruiting Senior BBVA CF F&R')),
  'filtro', 'BBVA',
  'unidad', 'UG 02 · BBVA'
));
