# Talento NFQ · staffing y recruiting (UG 02 · BBVA)

Aplicación web para gestionar en una sola pantalla:

- **Necesidades** del negocio y su cruce con el pool (puntuación por skills, coberturas).
- **Pool de talento** (solo personas con consentimiento LOPD en vigor).
- **Ofertas públicas** por canal (LinkedIn, Web NFQ, InfoJobs, Universidades, Referidos, Headhunter).
- **Funnel**: Preselección → Entrevista → Con cliente → Oferta → Contratado → Incorporado (+ Descartado).

## Contenido del repositorio

| Carpeta | Qué es |
|---|---|
| `public/` | La app productiva (necesita Supabase y Google configurados) |
| `supabase/migrations/` | Esquema de base de datos, roles y auditoría |
| `tests/` | Pruebas de extremo a extremo |
| `prototipo/` | Prototipo sin servidor con **datos ficticios**; lo sirve Vercel para revisar la experiencia |

El prototipo usa el mismo `app.js` que la app productiva. Lo único que cambia es que simula en el navegador el login, la base de datos y Drive (`prototipo/demo/demo.js`). Al cambiar `public/app.js`, copia el archivo también a `prototipo/app.js`.

## Arquitectura

| Pieza | Qué hace | Dónde vive |
|---|---|---|
| Web estática (`public/`) | Interfaz, lectura de Drive y cálculo del cruce en el navegador | Vercel |
| Supabase (`supabase/migrations/`) | Login, miembros/roles, necesidades, ofertas, funnel, pool, auditoría y tiempo real | Proyecto Supabase **corporativo de NFQ, región UE, con DPA** |
| Google Drive | Hojas de Recruiting: se leen con el permiso de Drive de cada usuario | Workspace NFQ |

Principios de datos:

- Las hojas de Recruiting **no se copian** a la base de datos.
- Las personas se identifican con una clave cifrada, **nunca** con email, teléfono ni LinkedIn.
- Quien no tenga consentimiento vigente no aparece.

Acceso:

- Solo entran cuentas `@nfq.es` dadas de alta en `miembros`.
- Hay tres roles:
  - `admin`: equipo, fuentes y auditoría.
  - `editor`: edita necesidades, ofertas, funnel y pool.
  - `lector`: solo lectura.
- Las reglas se aplican en la base de datos (RLS), no solo en la pantalla.

## Puesta en marcha (IT de NFQ)

### 1. Google Cloud (Workspace NFQ)

1. Crea o elige un proyecto en Google Cloud dentro de la organización NFQ.
2. Habilita **Google Drive API**.
3. En la pantalla de consentimiento OAuth:
   - Tipo **Interno**, para que solo entren cuentas NFQ.
   - Ámbito: `https://www.googleapis.com/auth/drive.readonly`.
4. Crea un **ID de cliente OAuth** de tipo «Aplicación web»:
   - Origen autorizado: la URL de Vercel (y el dominio propio si lo hay).
   - URI de redirección: `https://<proyecto>.supabase.co/auth/v1/callback`.

### 2. Supabase (cuenta corporativa)

1. Crea el proyecto en la organización corporativa de NFQ, con región UE (p. ej. `eu-west-1` o `eu-central-1`) y el DPA de Supabase firmado.
2. Activa el proveedor **Google** en *Authentication → Providers* con el client ID y el secret del paso 1.
3. En *Authentication → URL Configuration*:
   - Site URL: la URL de la app.
   - Redirect URLs: la misma URL.
4. Ejecuta la migración `supabase/migrations/20261015000000_init.sql`. Puedes usar el SQL Editor o `supabase db push`.
5. Da de alta al primer administrador desde el SQL Editor, que corre como `postgres` y salta RLS:

   ```sql
   insert into public.miembros (email, nombre, rol)
   values ('marcos.rodriguez@nfq.es', 'Marcos Rodríguez', 'admin');
   ```

6. Comprueba que *Database → Publications → supabase_realtime* incluye las tablas de la app. La migración las añade si la publicación existe.

### 3. Configurar y publicar la web

1. Rellena `public/config.js` con la URL del proyecto y la clave pública `anon`. Esa clave es pública por diseño: la seguridad la ponen RLS y el login.
2. Publica la carpeta `public/` en Vercel. Elige una de estas vías:
   - `cd public && npx vercel --prod` (preset «Other», sin build).
   - Arrastrar la carpeta en vercel.com/new.
   - Conectar el repo con *Root Directory* = `public`.
3. `vercel.json` ya incluye:
   - Cabeceras de seguridad (CSP estricta, HSTS, noindex).
   - `no-cache` para `config.js` y `app.js`.

Sin `config.js` relleno, la app muestra la pantalla «Falta conectar el servidor» y no hace nada más.

### 4. Primer uso

1. El admin entra con Google y concede la lectura de Drive.
2. En **Datos** comprueba las fuentes. Vienen precargadas: la base de Recruiting y la hoja BBVA CF F&R.
3. En **Equipo** da de alta a los demás miembros de la UG 02 con su rol.
4. Cada usuario necesita permiso de lectura en Drive sobre las hojas configuradas.

## Operación

- **Token de Drive**: Google lo da por una hora. Al caducar aparece «Reconectar Drive»; los datos compartidos siguen accesibles.
- **Alcance**: el filtro «Solo UG 02 · BBVA» se aplica sobre cliente y descripción. Lo cambia un admin en *Datos*.
- **Auditoría**: cada cambio queda registrado con autor, fecha y valores antes y después. La ven los admins en *Datos → Actividad reciente*.
- **Copias**: las del plan de Supabase (activar PITR si el plan lo permite).

## Pendiente

- Validación del **DPO**:
  - Base legal.
  - Plazo de conservación.
  - Registro de actividades de tratamiento.
- **Limpieza automática** de registros del funnel y del pool cuyo consentimiento haya caducado. La app ya los oculta, pero no los borra. Propuesta: job programado (pg_cron) que use la clave pública.
- Sin IA sobre CVs por decisión de esta fase.
- Conector directo con LinkedIn: hoy las ofertas por canal se gestionan a mano. LinkedIn Talent/Job Posting API requiere ser partner.

## Pruebas

```bash
python3 tests/serve.py public 8765    # sirve public/ con las cabeceras de vercel.json
node tests/e2e.js                      # Playwright + Supabase simulado
```

La prueba recorre estos casos:

- Login y alta de miembros.
- Una necesidad y el funnel.
- Un cambio en vivo de otro usuario.
- Rol lector.
- Usuario externo o no miembro.
- Token de Drive caducado.
- Modo oscuro y móvil.
- Violaciones de CSP.

La migración se ha probado sobre PostgreSQL local con los roles reales: el aislamiento por rol, la auditoría y la regla de «al menos un admin». **No se ha probado aún contra un Supabase ni un Drive reales.**

## Formación por capas (`formacion.html`)

Segunda pantalla de la misma instalación: la ruta formativa de cada persona según su perfil (banda, cuadrante de cliente, práctica) y su situación (alta, cambio, promoción, año en régimen). Ejecuta el procedimiento de Gestión del Conocimiento (SGC v2.0) por perfil; los módulos llevan su bloque del SGC, canal, evaluación y rol responsable.

| Pieza | Qué es |
|---|---|
| `supabase/migrations/20261020000000_formacion.sql` | Perfil en `miembros`, roles de formación (`rf`, `rct`, `rfun`, `rfp`), catálogo (`formacion_config`, `formacion_modulos`), eventos y progreso, RLS, la función `formacion_ruta()` y la asignación automática al cambiar el perfil |
| `supabase/seed/formacion_catalogo.sql` | Catálogo v0: 30 módulos tipo, 122 instancias (Cliente × 7 cuadrantes, Práctica × 9 prácticas). Idempotente |
| `public/formacion.html` + `public/formacion.js` | Pantallas: Mi ruta, Perfil, Equipo, Catálogo, Seguimiento. Mismo login y mismos miembros que la app |
| `prototipo/formacion.html` + `prototipo/demo/formacion-demo.js` | Prototipo sin servidor con personas y progreso ficticios |

Puesta en marcha: ejecutar la migración y después la semilla (como `postgres`); dar de alta los roles de formación en `formacion_roles` (al menos un `rf`); completar banda, cuadrante y práctica de cada miembro (la ruta se asigna sola). Al cambiar `public/formacion.js`, copiarlo también a `prototipo/formacion.js`.

Reglas que aplica la base de datos: la persona mueve su progreso entre pendiente, en curso y completado con evidencia; convalidar, eximir y validar es del mentor o de Formación; cada RFUN edita los módulos de su cuadrante y cada RFP los de su práctica; el cambio de banda, cuadrante o práctica lo registra Formación y dispara la reasignación.
