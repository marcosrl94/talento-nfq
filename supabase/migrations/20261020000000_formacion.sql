-- Talento NFQ · formación por capas (Firma · Cliente · Práctica · Proyecto)
-- Ejecuta el procedimiento de Gestión del Conocimiento (SGC v2.0) por perfil:
--   perfil (banda, cuadrante, práctica) + situación (alta, cambio, promoción, año)
--   → ruta = módulos que aplican → progreso por persona y módulo.
-- Las reglas de composición y los permisos viven aquí, no solo en la pantalla.
-- El catálogo (formacion_modulos) se siembra con supabase/seed/formacion_catalogo.sql.

-- ---------------------------------------------------------------------------
-- Perfil formativo del miembro
-- ---------------------------------------------------------------------------
alter table public.miembros
  add column if not exists categoria  text check (char_length(categoria) <= 40),
  add column if not exists banda      text check (banda in ('J', 'S', 'M', 'D')),
  add column if not exists cuadrante  text check (char_length(cuadrante) <= 20),
  add column if not exists practica   text check (char_length(practica) <= 20),
  add column if not exists practica2  text check (char_length(practica2) <= 20),
  add column if not exists mentor     text references public.miembros (email) on delete set null,
  add column if not exists proyecto   text check (char_length(proyecto) <= 120),
  add column if not exists fecha_alta date;
comment on column public.miembros.banda is 'J Junior (ASSI, CONS) · S Senior (CNSR, EXPR) · M Manager · D Dirección';
comment on column public.miembros.cuadrante is 'Cuadrante de cliente: SAN, BBVA, T2, SEG, RE, AM, LATAM';
comment on column public.miembros.practica is 'Práctica principal: BM, FIN, RSK, BME, AMW, SOS, CTL, REP, ANA';

-- ---------------------------------------------------------------------------
-- Roles de formación (los del SGC). Los roles de la app (admin/editor/lector)
-- siguen mandando sobre quién entra; estos dicen quién gobierna qué formación.
--   rf   Responsable de Formación de la firma        ámbito ''
--   rct  Cultura & Talento                           ámbito ''
--   rfun Responsable de Formación de la Unidad       ámbito = cuadrante
--   rfp  Responsable de Formación de la Práctica     ámbito = práctica
-- El mentor no se da de alta aquí: es miembros.mentor.
-- ---------------------------------------------------------------------------
create table public.formacion_roles (
  email  text not null references public.miembros (email) on delete cascade,
  rol    text not null check (rol in ('rf', 'rct', 'rfun', 'rfp')),
  ambito text not null default '' check (char_length(ambito) <= 20),
  creado timestamptz not null default now(),
  primary key (email, rol, ambito)
);
alter table public.formacion_roles enable row level security;
create policy formacion_roles_leer   on public.formacion_roles for select to authenticated using (public.puede_leer());
create policy formacion_roles_alta   on public.formacion_roles for insert to authenticated with check (public.es_admin());
create policy formacion_roles_cambio on public.formacion_roles for update to authenticated using (public.es_admin()) with check (public.es_admin());
create policy formacion_roles_baja   on public.formacion_roles for delete to authenticated using (public.es_admin());

create or replace function public.f_tiene(p_rol text, p_ambito text default null) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.formacion_roles r
    where r.email = public.mi_email() and r.rol = p_rol
      and (r.ambito = '' or r.ambito = p_ambito))   -- rol de firma (ámbito '') vale para todo; con ámbito, solo el suyo
$$;
-- Gobierna la formación de toda la firma.
create or replace function public.f_es_rf() returns boolean
language sql stable as $$ select public.es_admin() or public.f_tiene('rf') or public.f_tiene('rct') $$;
-- Puede ver la ruta y el progreso de una persona.
create or replace function public.f_ve_persona(p_email text) returns boolean
language sql stable security definer set search_path = public
as $$
  select p_email = public.mi_email()
      or public.f_es_rf()
      or exists (select 1 from public.miembros m where m.email = p_email
                 and (m.mentor = public.mi_email()
                      or public.f_tiene('rfun', m.cuadrante)
                      or public.f_tiene('rfp', m.practica)
                      or public.f_tiene('rfp', m.practica2)))
$$;
-- Puede validar evidencias, convalidar y eximir.
create or replace function public.f_valida_persona(p_email text) returns boolean
language sql stable security definer set search_path = public
as $$
  select public.f_es_rf()
      or exists (select 1 from public.miembros m where m.email = p_email and m.mentor = public.mi_email())
$$;
-- Puede editar la ficha de un módulo: RF todo; RFUN su cuadrante; RFP su práctica.
create or replace function public.f_edita_modulo(p_data jsonb) returns boolean
language sql stable
as $$
  select public.f_es_rf()
      or (p_data ->> 'capa' = 'Cliente'  and public.f_tiene('rfun', p_data ->> 'cuadrante'))
      or (p_data ->> 'capa' = 'Práctica' and public.f_tiene('rfp',  p_data ->> 'practica'))
$$;

-- ---------------------------------------------------------------------------
-- Catálogo y configuración: documentos, como el resto de la app
--   formacion_config  ids: bandas, situaciones, cuadrantes, practicas, plantillas, reglas, integracion, defaults
--   formacion_modulos ids: F-01 … , C-01-BBVA … , P-01-SOS … , PR-01 …
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['formacion_config', 'formacion_modulos'] loop
    execute format($f$
      create table public.%1$I (
        id              text primary key check (id ~ '^[A-Za-z0-9_\-.~:@+]{1,200}$'),
        ug              text not null default 'ALL',
        data            jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 262144),
        actualizado     timestamptz not null default now(),
        actualizado_por text
      );
      create trigger %1$s_autor before insert or update on public.%1$I
        for each row execute function public.doc_autor();
      create trigger %1$s_auditar after insert or update or delete on public.%1$I
        for each row execute function public.auditar();
      alter table public.%1$I enable row level security;
      create policy %1$s_leer on public.%1$I for select to authenticated using (public.puede_leer());
    $f$, t);
  end loop;
end $$;

create policy formacion_config_alta   on public.formacion_config for insert to authenticated with check (public.f_es_rf());
create policy formacion_config_cambio on public.formacion_config for update to authenticated using (public.f_es_rf()) with check (public.f_es_rf());
create policy formacion_config_baja   on public.formacion_config for delete to authenticated using (public.es_admin());

create policy formacion_modulos_alta   on public.formacion_modulos for insert to authenticated with check (public.f_edita_modulo(data));
create policy formacion_modulos_cambio on public.formacion_modulos for update to authenticated using (public.f_edita_modulo(data)) with check (public.f_edita_modulo(data));
create policy formacion_modulos_baja   on public.formacion_modulos for delete to authenticated using (public.f_es_rf());

create index formacion_modulos_capa_idx on public.formacion_modulos ((data ->> 'capa'));
create index formacion_modulos_cuad_idx on public.formacion_modulos ((data ->> 'cuadrante'));
create index formacion_modulos_prac_idx on public.formacion_modulos ((data ->> 'practica'));

-- ---------------------------------------------------------------------------
-- Eventos de perfil: lo que dispara una (re)asignación de módulos
-- ---------------------------------------------------------------------------
create table public.formacion_eventos (
  id     text primary key check (id ~ '^[A-Za-z0-9_\-.~:@+]{1,200}$'),
  email  text not null references public.miembros (email) on delete cascade,
  tipo   text not null check (tipo in ('alta', 'cambio_ug', 'cambio_practica', 'promocion', 'anual')),
  fecha  date not null default current_date,
  por    text,
  data   jsonb not null default '{}'::jsonb
);
create index formacion_eventos_email_idx on public.formacion_eventos (email, fecha desc);
alter table public.formacion_eventos enable row level security;
create policy formacion_eventos_leer on public.formacion_eventos for select to authenticated using (public.f_ve_persona(email));

-- ---------------------------------------------------------------------------
-- Progreso: una fila por persona y módulo
--   pendiente → en_curso → completado (evidencia) ; convalidado / exento los pone quien valida
-- ---------------------------------------------------------------------------
create table public.formacion_progreso (
  id              text primary key check (id ~ '^[A-Za-z0-9_\-.~:@+]+$' and char_length(id) <= 260),
  email           text not null references public.miembros (email) on delete cascade,
  modulo          text not null references public.formacion_modulos (id) on delete cascade,
  evento          text references public.formacion_eventos (id) on delete set null,
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'en_curso', 'completado', 'convalidado', 'exento')),
  fecha           date,
  horas           numeric(6,1) check (horas is null or horas >= 0),
  evidencia       text check (char_length(evidencia) <= 500),
  nota            text check (char_length(nota) <= 500),
  validado_por    text,
  validado        timestamptz,
  actualizado     timestamptz not null default now(),
  actualizado_por text,
  unique (email, modulo)
);
create index formacion_progreso_email_idx on public.formacion_progreso (email);
create index formacion_progreso_modulo_idx on public.formacion_progreso (modulo);

-- La persona solo puede mover su propio progreso entre pendiente, en_curso y completado;
-- convalidar, eximir y validar es de mentor, RF, C&T o administrador.
create or replace function public.formacion_progreso_guardar() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.actualizado := now();
  new.actualizado_por := public.mi_email();
  if not public.f_valida_persona(new.email) then
    if new.estado in ('convalidado', 'exento') then
      raise exception 'Solo el mentor o Formación pueden convalidar o eximir';
    end if;
    new.validado_por := case when tg_op = 'UPDATE' then old.validado_por end;
    new.validado     := case when tg_op = 'UPDATE' then old.validado end;
  elsif new.estado in ('completado', 'convalidado', 'exento') and new.validado_por is distinct from public.mi_email()
        and (tg_op = 'INSERT' or new.estado is distinct from old.estado or new.validado_por is distinct from old.validado_por) then
    new.validado_por := public.mi_email();
    new.validado := now();
  end if;
  if new.estado in ('completado', 'convalidado', 'exento') and new.fecha is null then
    new.fecha := current_date;
  end if;
  return new;
end $$;
create trigger formacion_progreso_guardar before insert or update on public.formacion_progreso
  for each row execute function public.formacion_progreso_guardar();

create or replace function public.auditar_progreso() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.auditoria (tabla, doc_id, accion, por, antes, despues)
  values ('formacion_progreso', coalesce(new.id, old.id),
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'cambio' else 'baja' end,
    public.mi_email(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger formacion_progreso_auditar after insert or update or delete on public.formacion_progreso
  for each row execute function public.auditar_progreso();

alter table public.formacion_progreso enable row level security;
create policy formacion_progreso_leer   on public.formacion_progreso for select to authenticated using (public.f_ve_persona(email));
create policy formacion_progreso_alta   on public.formacion_progreso for insert to authenticated with check (email = public.mi_email() or public.f_valida_persona(email));
create policy formacion_progreso_cambio on public.formacion_progreso for update to authenticated using (email = public.mi_email() or public.f_valida_persona(email)) with check (email = public.mi_email() or public.f_valida_persona(email));
create policy formacion_progreso_baja   on public.formacion_progreso for delete to authenticated using (public.f_es_rf());

-- ---------------------------------------------------------------------------
-- La ruta: qué módulos aplican a una persona para una situación.
-- Misma regla que la pantalla y que el simulador del catálogo:
--   · el módulo prevé la situación (eventos)
--   · aplica a la banda como obligatorio o recomendado (electivo se pide aparte)
--   · Cliente: solo el cuadrante de la persona
--   · Práctica: la principal entera; de la secundaria solo P-01, P-03 y P-06
-- ---------------------------------------------------------------------------
create or replace function public.formacion_ruta(p_email text, p_tipo text, p_electivos boolean default false)
returns table (modulo text, capa text, nombre text, horas numeric, aplica text, tpl text)
language sql stable security definer set search_path = public
as $$
  select m.id, m.data ->> 'capa', m.data ->> 'nombre',
         coalesce((m.data ->> 'horas')::numeric, 0), m.data -> 'aplica' ->> p.banda, m.data ->> 'tpl'
  from public.miembros p
  join public.formacion_modulos m
    on (m.data -> 'eventos') ? p_tipo
   and (m.data -> 'aplica' ->> p.banda) in ('obl', 'rec', case when p_electivos then 'ele' end)
   and (m.data ->> 'capa' <> 'Cliente'  or m.data ->> 'cuadrante' = p.cuadrante)
   and (m.data ->> 'capa' <> 'Práctica' or m.data ->> 'practica' = p.practica
        or (p.practica2 is not null and m.data ->> 'practica' = p.practica2
            and m.data ->> 'tpl' in ('P-01', 'P-03', 'P-06')))
  where p.email = p_email and public.f_ve_persona(p_email)
  order by case m.data ->> 'capa' when 'Firma' then 1 when 'Cliente' then 2 when 'Práctica' then 3 else 4 end, m.id
$$;

-- Asignar: crea el evento y una fila de progreso pendiente por módulo de la ruta
-- (no toca las filas que ya existan: lo completado se conserva).
create or replace function public.formacion_asignar(p_email text, p_tipo text, p_fecha date default current_date, p_data jsonb default '{}'::jsonb)
returns integer
language plpgsql security definer set search_path = public
as $$
declare ev text; n integer;
begin
  if not (p_email = public.mi_email() or public.f_valida_persona(p_email)) then
    raise exception 'Sin permiso para asignar formación a %', p_email;
  end if;
  ev := p_email || ':' || p_tipo || ':' || to_char(p_fecha, 'YYYYMMDD');
  insert into public.formacion_eventos (id, email, tipo, fecha, por, data)
  values (ev, p_email, p_tipo, p_fecha, public.mi_email(), coalesce(p_data, '{}'::jsonb))
  on conflict (id) do nothing;
  insert into public.formacion_progreso (id, email, modulo, evento, estado)
  select p_email || ':' || r.modulo, p_email, r.modulo, ev, 'pendiente'
  from public.formacion_ruta(p_email, p_tipo) r
  on conflict (email, modulo) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Al cambiar el perfil, la ruta se recompone sola.
create or replace function public.formacion_perfil_cambiado() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.banda is null or new.cuadrante is null or new.practica is null then return new; end if;
  if tg_op = 'UPDATE' and (old.banda is null or old.cuadrante is null or old.practica is null) then
    perform public.formacion_asignar(new.email, 'alta', coalesce(new.fecha_alta, current_date));
  elsif tg_op = 'UPDATE' then
    if new.cuadrante is distinct from old.cuadrante then perform public.formacion_asignar(new.email, 'cambio_ug'); end if;
    if new.practica is distinct from old.practica or new.practica2 is distinct from old.practica2 then perform public.formacion_asignar(new.email, 'cambio_practica'); end if;
    if new.banda is distinct from old.banda then perform public.formacion_asignar(new.email, 'promocion'); end if;
  end if;
  return new;
end $$;
create trigger miembros_formacion after update of banda, cuadrante, practica, practica2 on public.miembros
  for each row execute function public.formacion_perfil_cambiado();

-- El perfil lo cambian administradores, RF y C&T. La persona puede rellenarlo si está vacío (perfilado inicial).
drop policy if exists miembros_cambio on public.miembros;
create policy miembros_cambio on public.miembros for update to authenticated
  using (public.es_admin() or public.f_es_rf() or email = public.mi_email())
  with check (public.es_admin() or public.f_es_rf() or email = public.mi_email());
create or replace function public.miembros_solo_perfil() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.es_admin() or public.f_es_rf() then return new; end if;
  -- Sin rol de formación solo se puede completar el propio perfil, nunca tocar rol, ug ni mentor.
  if new.rol is distinct from old.rol or new.ug is distinct from old.ug or new.nombre is distinct from old.nombre
     or new.mentor is distinct from old.mentor then
    raise exception 'Solo un administrador cambia rol, unidad, nombre o mentor';
  end if;
  if old.banda is not null and old.cuadrante is not null and old.practica is not null
     and (new.banda is distinct from old.banda or new.cuadrante is distinct from old.cuadrante or new.practica is distinct from old.practica) then
    raise exception 'El cambio de banda, cuadrante o práctica lo registra Formación';
  end if;
  return new;
end $$;
create trigger miembros_solo_perfil before update on public.miembros
  for each row execute function public.miembros_solo_perfil();

-- Carga inicial de perfiles desde la hoja de RR. HH. / My.NFQ (solo Formación o administradores).
-- Cada fila: email, nombre, categoria, banda (opcional: se deduce de la categoría), cuadrante,
-- practica, practica2, mentor, proyecto, fecha_alta. Da de alta al miembro si no existe (rol lector)
-- y actualiza el perfil; la ruta se asigna por el trigger de perfil.
create or replace function public.formacion_banda_de(p_categoria text) returns text
language sql immutable as $$
  select case
    when p_categoria ~* '^(assi|assistant|cons$|consultant$|consultor$)' then 'J'
    when p_categoria ~* '(cnsr|senior|expr|expert)' and p_categoria !~* 'manager' then 'S'
    when p_categoria ~* 'manager|mgr|smgr' then 'M'
    when p_categoria ~* 'director|partner|socio' then 'D'
  end
$$;

create or replace function public.formacion_importar_perfiles(p_filas jsonb)
returns table (email text, resultado text)
language plpgsql security definer set search_path = public
as $$
declare f jsonb; e text; b text; existe boolean;
begin
  if not public.f_es_rf() then raise exception 'Solo Formación o un administrador pueden importar perfiles'; end if;
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'Se esperaba una lista de filas'; end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    e := lower(trim(coalesce(f ->> 'email', '')));
    begin
      if e = '' then raise exception 'sin email'; end if;
      b := coalesce(nullif(upper(trim(f ->> 'banda')), ''), public.formacion_banda_de(f ->> 'categoria'));
      if b is null then raise exception 'banda desconocida para la categoría «%»', f ->> 'categoria'; end if;
      if nullif(f ->> 'cuadrante', '') is null or nullif(f ->> 'practica', '') is null then raise exception 'faltan cuadrante o práctica'; end if;
      select exists (select 1 from public.miembros m where m.email = e) into existe;
      if not existe then
        insert into public.miembros (email, nombre, rol) values (e, nullif(trim(f ->> 'nombre'), ''), 'lector');
      end if;
      update public.miembros m set
        nombre     = coalesce(nullif(trim(f ->> 'nombre'), ''), m.nombre),
        categoria  = coalesce(nullif(trim(f ->> 'categoria'), ''), m.categoria),
        banda      = b,
        cuadrante  = upper(trim(f ->> 'cuadrante')),
        practica   = upper(trim(f ->> 'practica')),
        practica2  = nullif(upper(trim(coalesce(f ->> 'practica2', ''))), ''),
        mentor     = coalesce(nullif(lower(trim(coalesce(f ->> 'mentor', ''))), ''), m.mentor),
        proyecto   = coalesce(nullif(trim(f ->> 'proyecto'), ''), m.proyecto),
        fecha_alta = coalesce(nullif(trim(f ->> 'fecha_alta'), '')::date, m.fecha_alta)
      where m.email = e;
      email := e; resultado := case when existe then 'actualizado' else 'alta' end; return next;
    exception when others then
      email := e; resultado := 'error: ' || sqlerrm; return next;
    end;
  end loop;
end $$;

-- Resumen por persona (para Equipo y Seguimiento), con la misma visibilidad que el progreso.
create or replace view public.formacion_resumen
with (security_invoker = true) as
select m.email, m.nombre, m.banda, m.cuadrante, m.practica, m.practica2, m.mentor, m.fecha_alta,
       count(p.id)                                                   as modulos,
       count(p.id) filter (where p.estado in ('completado', 'convalidado', 'exento')) as cerrados,
       count(p.id) filter (where p.estado = 'pendiente' and (mo.data -> 'aplica' ->> m.banda) = 'obl') as obligatorios_pendientes,
       coalesce(sum(coalesce((mo.data ->> 'horas')::numeric, 0)), 0) as horas_plan,
       coalesce(sum(coalesce(p.horas, (mo.data ->> 'horas')::numeric, 0)) filter (where p.estado in ('completado', 'convalidado')), 0) as horas_hechas,
       max(p.actualizado)                                            as ultima_actividad
from public.miembros m
left join public.formacion_progreso p on p.email = m.email
left join public.formacion_modulos mo on mo.id = p.modulo
where public.f_ve_persona(m.email)
group by m.email;

-- ---------------------------------------------------------------------------
-- Tiempo real
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.formacion_config, public.formacion_modulos, public.formacion_progreso, public.formacion_eventos, public.formacion_roles;
  end if;
end $$;
