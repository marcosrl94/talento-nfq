/* Talento NFQ · formación por capas (Firma · Cliente · Práctica · Proyecto). Código de la pantalla (sin datos).
   Con window.FORMACION_DEMO presente trabaja en memoria con datos ficticios; si no, contra Supabase
   (tablas formacion_* y perfil en miembros; las reglas y permisos de verdad están en la base de datos). */
(function(){
'use strict';
const CFG = window.TALENTO_CONFIG || {};
const DEMO = window.FORMACION_DEMO || null;
const DOMAIN = String(CFG.allowedDomain || 'nfq.es').toLowerCase();

let nf; try{ nf = new Intl.NumberFormat('es-ES',{maximumFractionDigits:1}); nf.format(1); }catch(_){ nf = {format:String}; }
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const fdate = iso => { if(!iso) return ''; const a = String(iso).slice(0,10).split('-'); return a[2]+'/'+a[1]+'/'+a[0]; };
const ftime = iso => { if(!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : pad(d.getDate())+'/'+pad(d.getMonth()+1)+' a las '+pad(d.getHours())+':'+pad(d.getMinutes()); };
const today = () => { const d = new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
const clone = o => JSON.parse(JSON.stringify(o==null?null:o));
const h = (n, one, many) => nf.format(n)+' '+(n===1?one:many);
const hrs = n => nf.format(Math.round((n||0)*10)/10)+' h';
const norm = s => String(s||'').normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase();

const CAPAS = ['Firma','Cliente','Práctica','Proyecto'];
const APL = {obl:'Obligatorio', rec:'Recomendado', ele:'Electivo'};
const ESTADOS = {pendiente:'Pendiente', en_curso:'En curso', completado:'Completado', convalidado:'Convalidado', exento:'Exento'};
const CERRADO = ['completado','convalidado','exento'];
const EST_CLASS = {pendiente:'', en_curso:'info', completado:'ok', convalidado:'ok', exento:''};
const MAT = {existe:['Existe','go'], adaptar:['Adaptar','warn'], crear:['Por crear','stop']};
const CAT2BANDA = {'Assistant':'J','Consultant':'J','Consultant Senior':'S','Expert':'S','Manager':'M','Senior Manager':'M','Director':'D','Partner':'D'};
const OBJETIVO_H = 40;

/* ---------- estado ---------- */
const DB = {config:{}, modulos:{}, personas:{}, roles:[], progreso:{}, eventos:{}, ok:false, err:null, loading:true};
let ME = {email:'', rol:null, nombre:''};
const S = {view:'ruta', person:null, capa:'', eq:{cuad:'',prac:'',q:'',pend:false}, cat:{capa:'',cuad:'',prac:'',estado:'',q:''}, wiz:{email:null, draft:null}, seg:{sit:'alta'}};
const AUTH = {state:'init', msg:''};

/* ---------- permisos (espejo de las políticas RLS) ---------- */
const tiene = (rol, ambito) => DB.roles.some(r => r.email===ME.email && r.rol===rol && (r.ambito==='' || (ambito && r.ambito===ambito)));
const isAdmin = () => ME.rol==='admin';
const esRF = () => isAdmin() || tiene('rf') || tiene('rct');
const vePersona = p => !!p && (p.email===ME.email || esRF() || p.mentor===ME.email || tiene('rfun', p.cuadrante) || tiene('rfp', p.practica) || (!!p.practica2 && tiene('rfp', p.practica2)));
const valida = p => !!p && (esRF() || p.mentor===ME.email);
const editaModulo = m => !!m && (esRF() || (m.capa==='Cliente' && tiene('rfun', m.cuadrante)) || (m.capa==='Práctica' && tiene('rfp', m.practica)));
const editaPerfil = p => !!p && (esRF() || (p.email===ME.email && !perfilCompleto(p)));
const perfilCompleto = p => !!(p && p.banda && p.cuadrante && p.practica);

/* ---------- catálogo ---------- */
const cfg = k => DB.config[k] || {};
const items = k => (cfg(k).items || []);
const byId = (k, id) => items(k).find(x => x.id===id) || null;
const nombreCuad = id => (byId('cuadrantes', id)||{}).nombre || id || '—';
const nombrePrac = id => (byId('practicas', id)||{}).nombre || id || '—';
const nombreBanda = id => (byId('bandas', id)||{}).nombre || id || '—';
const nombreSit = id => (byId('situaciones', id)||{}).nombre || id;
const who = email => !email ? '—' : email===ME.email ? 'ti' : ((DB.personas[email] && DB.personas[email].nombre) || String(email).split('@')[0]);

/* La ruta: misma regla que formacion_ruta() en la base de datos. */
function ruta(p, tipo, electivos){
  if(!perfilCompleto(p)) return [];
  const out = [];
  for(const m of Object.values(DB.modulos)){
    if(!(m.eventos||[]).includes(tipo)) continue;
    const a = m.aplica && m.aplica[p.banda];
    if(!(a==='obl' || a==='rec' || (electivos && a==='ele'))) continue;
    if(m.capa==='Cliente' && m.cuadrante!==p.cuadrante) continue;
    if(m.capa==='Práctica'){
      const principal = m.practica===p.practica;
      const secundaria = !!p.practica2 && p.practica2!==p.practica && m.practica===p.practica2 && ['P-01','P-03','P-06'].includes(m.tpl);
      if(!principal && !secundaria) continue;
    }
    out.push(m);
  }
  return out.sort((x,y) => CAPAS.indexOf(x.capa)-CAPAS.indexOf(y.capa) || x.id.localeCompare(y.id));
}
const horasDe = list => list.reduce((n,m) => n+(Number(m.horas)||0), 0);
const progresoDe = email => Object.values(DB.progreso).filter(r => r.email===email);
function resumen(p){
  const rows = progresoDe(p.email);
  const mods = rows.map(r => DB.modulos[r.modulo]).filter(Boolean);
  const plan = horasDe(mods);
  const hechas = rows.filter(r => r.estado==='completado' || r.estado==='convalidado').reduce((n,r) => n+(Number(r.horas)||Number((DB.modulos[r.modulo]||{}).horas)||0), 0);
  const cerrados = rows.filter(r => CERRADO.includes(r.estado)).length;
  const oblPend = rows.filter(r => r.estado==='pendiente' && DB.modulos[r.modulo] && DB.modulos[r.modulo].aplica[p.banda]==='obl').length;
  const porValidar = rows.filter(r => r.estado==='completado' && !r.validado_por).length;
  const ult = rows.reduce((a,r) => (r.actualizado||'') > a ? r.actualizado : a, '');
  return {modulos:rows.length, cerrados, plan, hechas, oblPend, porValidar, ult, pct: rows.length ? Math.round(cerrados/rows.length*100) : 0};
}
function situacionPara(p, draft){
  if(!perfilCompleto(p)) return 'alta';
  if(draft.cuadrante!==p.cuadrante) return 'cambio_ug';
  if(draft.practica!==p.practica || (draft.practica2||'')!==(p.practica2||'')) return 'cambio_practica';
  if(draft.banda!==p.banda) return 'promocion';
  return null;
}

/* ---------- adaptador de datos: demo en memoria o Supabase ---------- */
function demoApi(){
  const D = DEMO;
  function put(k, row){ DB[k][row.id] = row; }
  return {
    async load(){
      D.config && Object.keys(D.config).forEach(k => DB.config[k] = D.config[k]);
      (D.modulos||[]).forEach(m => DB.modulos[m.id] = m);
      (D.personas||[]).forEach(p => DB.personas[p.email] = p);
      DB.roles = clone(D.roles||[]);
      (D.progreso||[]).forEach(r => DB.progreso[r.id] = r);
      (D.eventos||[]).forEach(e => DB.eventos[e.id] = e);
      const me = DB.personas[D.me]; ME = {email:D.me, rol:(me&&me.rol)||'lector', nombre:(me&&me.nombre)||''};
      AUTH.state = 'ok'; DB.ok = true; DB.loading = false;
    },
    async saveProgreso(row){
      const old = DB.progreso[row.id]; const p = DB.personas[row.email];
      if(!(row.email===ME.email || valida(p))) throw new Error('Sin permiso');
      if(!valida(p) && ['convalidado','exento'].includes(row.estado)) throw new Error('Solo el mentor o Formación pueden convalidar o eximir');
      const r = Object.assign({}, old||{}, row, {actualizado:new Date().toISOString(), actualizado_por:ME.email});
      if(valida(p) && CERRADO.includes(r.estado) && (!old || old.estado!==r.estado || row.validado_por===ME.email)){ r.validado_por = ME.email; r.validado = r.actualizado; }
      if(!valida(p)){ r.validado_por = old ? old.validado_por : null; r.validado = old ? old.validado : null; }
      if(CERRADO.includes(r.estado) && !r.fecha) r.fecha = today();
      put('progreso', r); return r;
    },
    async asignar(email, tipo, fecha){
      const p = DB.personas[email]; if(!(email===ME.email || valida(p))) throw new Error('Sin permiso');
      const ev = email+':'+tipo+':'+String(fecha||today()).replace(/-/g,'');
      if(!DB.eventos[ev]) DB.eventos[ev] = {id:ev, email, tipo, fecha:fecha||today(), por:ME.email};
      let n = 0;
      for(const m of ruta(p, tipo)){ const id = email+':'+m.id; if(!DB.progreso[id]){ DB.progreso[id] = {id, email, modulo:m.id, evento:ev, estado:'pendiente', actualizado:new Date().toISOString(), actualizado_por:ME.email}; n++; } }
      return n;
    },
    async savePerfil(email, patch){
      const p = DB.personas[email] || {email, rol:'lector'}; if(!editaPerfil(p) && !esRF()) throw new Error('Sin permiso');
      const old = clone(p); const nuevo = Object.assign({}, p, patch); DB.personas[email] = nuevo;
      if(!perfilCompleto(nuevo)) return;
      if(!perfilCompleto(old)) await this.asignar(email, 'alta', nuevo.fecha_alta || today());
      else {
        if(nuevo.cuadrante!==old.cuadrante) await this.asignar(email, 'cambio_ug');
        if(nuevo.practica!==old.practica || (nuevo.practica2||'')!==(old.practica2||'')) await this.asignar(email, 'cambio_practica');
        if(nuevo.banda!==old.banda) await this.asignar(email, 'promocion');
      }
    },
    async saveModulo(m){ if(!editaModulo(m)) throw new Error('Sin permiso'); DB.modulos[m.id] = Object.assign({}, m, {actualizado:new Date().toISOString(), actualizado_por:ME.email}); },
    signIn(){}, signOut(){ location.reload(); }
  };
}

function sbApi(){
  const sb = (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}}) : null;
  const rowToDoc = r => Object.assign({}, r.data||{}, {actualizado:r.actualizado, actualizado_por:r.actualizado_por});
  async function table(t, q){ let qq = sb.from(t).select('*'); if(q) qq = q(qq); const {data, error} = await qq; if(error) throw error; return data||[]; }
  async function loadAll(){
    const [cfgRows, mods, pers, roles, prog, evs] = await Promise.all([table('formacion_config'), table('formacion_modulos'), table('miembros'), table('formacion_roles'), table('formacion_progreso'), table('formacion_eventos')]);
    DB.config = {}; cfgRows.forEach(r => DB.config[r.id] = r.data);
    DB.modulos = {}; mods.forEach(r => DB.modulos[r.id] = rowToDoc(r));
    DB.personas = {}; pers.forEach(p => DB.personas[p.email] = p);
    DB.roles = roles; DB.progreso = {}; prog.forEach(r => DB.progreso[r.id] = r); DB.eventos = {}; evs.forEach(e => DB.eventos[e.id] = e);
    const me = DB.personas[ME.email]; ME.rol = me ? me.rol : null; ME.nombre = me ? me.nombre : '';
    DB.ok = true; DB.err = null;
  }
  let chan = null;
  return {
    async load(){
      if(!sb){ AUTH.state = 'noconfig'; DB.loading = false; return; }
      const {data:{session}} = await sb.auth.getSession();
      if(!session){ AUTH.state = 'out'; DB.loading = false; return; }
      const email = String(session.user.email||'').toLowerCase();
      if(!email.endsWith('@'+DOMAIN)){ AUTH.state = 'domain'; AUTH.msg = email; DB.loading = false; return; }
      ME = {email, rol:null, nombre:''};
      try{ await loadAll(); AUTH.state = ME.rol ? 'ok' : 'nomember'; }catch(e){ DB.err = e.message||String(e); AUTH.state = 'ok'; }
      DB.loading = false;
      if(!chan && AUTH.state==='ok'){
        chan = sb.channel('formacion');
        ['formacion_progreso','formacion_modulos','formacion_config','formacion_eventos','miembros','formacion_roles'].forEach(t => chan.on('postgres_changes', {event:'*', schema:'public', table:t}, () => { loadAll().then(render).catch(()=>{}); }));
        chan.subscribe();
      }
    },
    async saveProgreso(row){
      const body = {id:row.id, email:row.email, modulo:row.modulo, evento:row.evento||null, estado:row.estado, fecha:row.fecha||null, horas:row.horas==null?null:row.horas, evidencia:row.evidencia||null, nota:row.nota||null, validado_por:row.validado_por||null};
      const {data, error} = await sb.from('formacion_progreso').upsert(body, {onConflict:'id'}).select().single(); if(error) throw error;
      DB.progreso[data.id] = data; return data;
    },
    async asignar(email, tipo, fecha){ const {data, error} = await sb.rpc('formacion_asignar', {p_email:email, p_tipo:tipo, p_fecha:fecha||today()}); if(error) throw error; await loadAll(); return data; },
    async savePerfil(email, patch){ const {error} = await sb.from('miembros').update(patch).eq('email', email); if(error) throw error; await loadAll(); },
    async saveModulo(m){ const data = clone(m); delete data.actualizado; delete data.actualizado_por; const {error} = await sb.from('formacion_modulos').upsert({id:m.id, ug:'ALL', data}, {onConflict:'id'}); if(error) throw error; DB.modulos[m.id] = m; },
    signIn(){ sb.auth.signInWithOAuth({provider:'google', options:{redirectTo: location.origin+location.pathname, queryParams:{hd:DOMAIN, prompt:'select_account'}}}); },
    async signOut(){ await sb.auth.signOut(); location.reload(); }
  };
}
const api = DEMO ? demoApi() : sbApi();

/* ---------- render ---------- */
const app = () => document.getElementById('app');
function toast(msg){ const t = document.getElementById('toast'); if(!t) return; t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function fail(e){ console.error(e); toast((e && e.message) || 'No se pudo guardar.'); }

function personasVisibles(){ return Object.values(DB.personas).filter(vePersona).sort((a,b) => String(a.nombre||a.email).localeCompare(String(b.nombre||b.email),'es')); }
function tabsDisponibles(){
  const T = [['ruta','Mi ruta'],['perfil','Perfil']];
  const equipo = personasVisibles().filter(p => p.email!==ME.email);
  if(equipo.length) T.push(['equipo','Equipo', equipo.length]);
  T.push(['catalogo','Catálogo', Object.keys(DB.modulos).length]);
  if(esRF()) T.push(['seguimiento','Seguimiento']);
  return T;
}
function renderChrome(){
  const T = tabsDisponibles();
  if(!T.some(t => t[0]===S.view)) S.view = 'ruta';
  const ok = AUTH.state==='ok';
  document.getElementById('tabs').innerHTML = T.map(t => '<button class="tab" role="tab" data-act="tab" data-id="'+t[0]+'" aria-selected="'+(ok && S.view===t[0])+'"'+(!ok?' disabled':'')+'>'+t[1]+(t[2]!=null?'<span class="tab-n">'+nf.format(t[2])+'</span>':'')+'</button>').join('');
  const u = document.getElementById('userbtn');
  if(u) u.innerHTML = ok ? '<span class="dot on"></span>'+esc(ME.nombre || ME.email)+(DEMO?' · demo':'')+'<span class="sr"> · cerrar sesión</span>' : '<span class="dot"></span>Sin sesión';
}
function render(){
  renderChrome();
  const el = app(); if(!el) return;
  if(DB.loading){ el.innerHTML = '<div class="empty">Cargando…</div>'; return; }
  if(AUTH.state!=='ok'){ el.innerHTML = viewConnect(); return; }
  el.innerHTML = S.view==='ruta' ? viewRuta() : S.view==='perfil' ? viewPerfil() : S.view==='equipo' ? viewEquipo() : S.view==='catalogo' ? viewCatalogo() : viewSeguimiento();
}
function viewConnect(){
  const msgs = {noconfig:['Falta conectar el servidor','Rellena <code>config.js</code> con la URL del proyecto de Supabase y la clave pública. Hasta entonces la pantalla no hace nada.'],
    out:['Tu formación, por capas','Firma, cliente, práctica y proyecto: la ruta que te toca según tu perfil, el progreso y lo que queda por hacer. Entra con tu cuenta de Google de NFQ.'],
    domain:['Solo cuentas de NFQ','Has entrado con '+esc(AUTH.msg)+'. Cierra sesión y vuelve con tu cuenta @'+esc(DOMAIN)+'.'],
    nomember:['Todavía no estás dado de alta','Tu cuenta es de NFQ pero no está en la lista de miembros. Pide el alta a un administrador de Talento NFQ.']};
  const [t, d] = msgs[AUTH.state] || msgs.out;
  return '<section class="connect"><h1>'+t+'</h1><p>'+d+'</p>'+(AUTH.state==='out' ? '<button class="btn big" data-act="signin">Entrar con Google</button>' : AUTH.state!=='noconfig' ? '<button class="btn quiet" data-act="signout">Cerrar sesión</button>' : '')+'</section>';
}

/* --- Mi ruta --- */
function personaActual(){ const p = DB.personas[S.person||ME.email]; return vePersona(p) ? p : DB.personas[ME.email]; }
function perfilChips(p){
  return '<div class="chips">'+(p.banda?'<span class="chip">'+esc(nombreBanda(p.banda))+(p.categoria&&p.categoria!==nombreBanda(p.banda)?' · '+esc(p.categoria):'')+'</span>':'')+(p.cuadrante?'<span class="chip">'+esc(nombreCuad(p.cuadrante))+'</span>':'')+(p.practica?'<span class="chip">'+esc(nombrePrac(p.practica))+'</span>':'')+(p.practica2?'<span class="chip half">'+esc(nombrePrac(p.practica2))+' (secundaria)</span>':'')+(p.mentor?'<span class="chip">Mentor: '+esc(who(p.mentor))+'</span>':'')+(p.proyecto?'<span class="chip">'+esc(p.proyecto)+'</span>':'')+'</div>';
}
function viewRuta(){
  const p = personaActual(); if(!p) return '<div class="empty">No hay perfil.</div>';
  const mio = p.email===ME.email;
  let html = '<div class="head"><div><h1>'+(mio?'Mi ruta':'Ruta de '+esc(p.nombre||p.email))+'</h1><p>'+(mio?'Lo que te toca según tu perfil, por capas. ':'')+'Las horas se comparan con las 40 h/año del plan de formación.</p></div>';
  html += '<div class="actions">'+(valida(p)&&!mio?'<button class="btn quiet sm" data-act="tab" data-id="equipo">← Equipo</button>':'')+(perfilCompleto(p)?'<button class="btn quiet sm" data-act="asignar" data-id="'+esc(p.email)+'" data-tipo="anual">Asignar año en régimen</button>':'')+'<button class="btn quiet sm" data-act="tab" data-id="perfil" data-email="'+esc(p.email)+'">'+(perfilCompleto(p)?'Ver perfil':'Completar perfil')+'</button></div></div>';
  if(!perfilCompleto(p)) return html + '<section class="panel"><div class="empty">Sin perfil formativo. '+(editaPerfil(p)?'<a href="#" data-act="tab" data-id="perfil" data-email="'+esc(p.email)+'">Completa el perfil</a> (banda, cuadrante y práctica) y la ruta se genera sola.':'Formación o el mentor tienen que completar banda, cuadrante y práctica.')+'</div></section>';
  html += perfilChips(p);
  const R = resumen(p), rows = progresoDe(p.email);
  const pct40 = Math.min(100, Math.round(R.hechas/OBJETIVO_H*100));
  html += '<div class="kpis"><div class="kpi"><b class="num">'+hrs(R.hechas)+'</b><span>hechas de '+hrs(R.plan)+' planificadas</span></div><div class="kpi"><b class="num">'+R.pct+' %</b><span>'+R.cerrados+' de '+R.modulos+' módulos cerrados</span></div><div class="kpi"><b class="num">'+R.oblPend+'</b><span>obligatorios pendientes</span></div><div class="kpi"><b class="num">'+pct40+' %</b><span>del objetivo de 40 h/año</span></div></div>';
  html += '<div class="prog" title="Horas hechas sobre 40"><i style="width:'+pct40+'%"></i></div>';
  if(!rows.length) html += '<section class="panel"><div class="empty">Perfil completo pero sin módulos asignados. '+(valida(p)||mio?'<button class="btn sm" data-act="asignar" data-id="'+esc(p.email)+'" data-tipo="alta">Asignar ruta de incorporación</button>':'')+'</div></section>';
  html += '<div class="subtabs" role="tablist">'+[['','Todas'],...CAPAS.map(c=>[c,c])].map(([k,l]) => '<button class="subtab" role="tab" data-act="capa" data-id="'+k+'" aria-selected="'+(S.capa===k)+'">'+l+'<b>'+(k?rows.filter(r=>(DB.modulos[r.modulo]||{}).capa===k).length:rows.length)+'</b></button>').join('')+'</div>';
  for(const c of CAPAS){
    if(S.capa && S.capa!==c) continue;
    const g = rows.map(r => ({r, m:DB.modulos[r.modulo]})).filter(x => x.m && x.m.capa===c).sort((a,b) => a.m.id.localeCompare(b.m.id));
    if(!g.length) continue;
    html += '<section class="panel capa"><div class="capa-h"><h2>'+c+'</h2><span class="note">'+hrs(horasDe(g.map(x=>x.m)))+' · '+g.filter(x=>CERRADO.includes(x.r.estado)).length+'/'+g.length+' cerrados</span></div>';
    html += g.map(({r,m}) => rutaRow(p, r, m)).join('')+'</section>';
  }
  return html;
}
function rutaRow(p, r, m){
  const a = m.aplica[p.banda]; const mio = p.email===ME.email; const v = valida(p);
  const acts = [];
  if(mio || v){
    if(r.estado==='pendiente') acts.push('<button class="btn quiet sm" data-act="estado" data-id="'+esc(r.id)+'" data-estado="en_curso">Empezar</button>');
    if(r.estado!=='completado' && !['convalidado','exento'].includes(r.estado)) acts.push('<button class="btn sm" data-act="completar" data-id="'+esc(r.id)+'">Marcar completado</button>');
    if(v && !['convalidado'].includes(r.estado) && ['P-01','P-04'].includes(m.tpl)) acts.push('<button class="btn quiet sm" data-act="estado" data-id="'+esc(r.id)+'" data-estado="convalidado">Convalidar</button>');
    if(v && r.estado!=='exento' && a!=='obl') acts.push('<button class="btn quiet sm" data-act="estado" data-id="'+esc(r.id)+'" data-estado="exento">Eximir</button>');
    if(CERRADO.includes(r.estado) && (v || (mio && r.estado==='completado' && !r.validado_por))) acts.push('<button class="linkbtn" data-act="estado" data-id="'+esc(r.id)+'" data-estado="pendiente">Reabrir</button>');
  }
  const val = r.estado==='completado' ? (r.validado_por ? '<span class="tag go">Validado por '+esc(who(r.validado_por))+'</span>' : (v?'<button class="btn sm" data-act="validar" data-id="'+esc(r.id)+'">Validar</button>':'<span class="tag warn">Pendiente de validar</span>')) : '';
  return '<div class="mrow"><div class="mrow-id"><code>'+esc(m.id)+'</code></div><div class="mrow-b"><a href="#" class="mname" data-act="modulo" data-id="'+esc(m.id)+'">'+esc(m.nombre)+'</a>'+
    '<div class="mmeta"><span class="pill '+(a==='obl'?'crit':'')+'">'+APL[a]+'</span><span class="pill '+EST_CLASS[r.estado]+'">'+ESTADOS[r.estado]+'</span>'+(r.fecha?'<span class="note">'+fdate(r.fecha)+'</span>':'')+val+(r.evidencia?'<span class="note">· '+esc(r.evidencia)+'</span>':'')+(r.nota?'<span class="note">· '+esc(r.nota)+'</span>':'')+'<span class="note">· '+esc(m.bloque)+' · '+esc(m.momento)+'</span></div></div>'+
    '<div class="mrow-h num">'+hrs(m.horas)+'</div><div class="mrow-a">'+acts.join('')+'</div></div>';
}

/* --- Perfil / perfilado --- */
function viewPerfil(){
  const puedeElegir = personasVisibles().filter(p => editaPerfil(p) || valida(p));
  const email = S.wiz.email || (puedeElegir.some(p=>p.email===ME.email) ? ME.email : (puedeElegir[0]||{}).email) || ME.email;
  const p = DB.personas[email] || {email, rol:'lector'};
  if(!S.wiz.draft || S.wiz.draft.email!==email) S.wiz.draft = {email, categoria:p.categoria||'', banda:p.banda||'', cuadrante:p.cuadrante||'', practica:p.practica||'', practica2:p.practica2||'', mentor:p.mentor||'', proyecto:p.proyecto||'', fecha_alta:p.fecha_alta||today()};
  const d = S.wiz.draft; const puede = editaPerfil(p);
  const sit = perfilCompleto(d) ? situacionPara(p, d) : null;
  const prev = perfilCompleto(d) ? ruta(d, sit || 'alta') : [];
  const nuevos = prev.filter(m => !DB.progreso[email+':'+m.id]);
  const opt = (list, val, label, first) => (first!==undefined?'<option value="">'+esc(first)+'</option>':'')+list.map(x => '<option value="'+esc(x.id)+'"'+(x.id===val?' selected':'')+'>'+esc(label(x))+'</option>').join('');
  let html = '<div class="head"><div><h1>'+(email===ME.email?'Mi perfil formativo':'Perfil de '+esc(p.nombre||email))+'</h1><p>Cuatro datos deciden la ruta: banda, cuadrante de cliente, práctica y situación. Al guardar, la ruta se asigna sola'+(DEMO?'':' (lo hace la base de datos)')+'.</p></div>';
  if(puedeElegir.length>1) html += '<div class="actions"><label class="note">Persona <select data-act="wizperson">'+opt(puedeElegir.map(x=>({id:x.email, n:x.nombre||x.email})), email, x=>x.n)+'</select></label></div>';
  html += '</div>';
  if(!puede) html += '<div class="banner-soft">El perfil ya está completo. Los cambios de banda, cuadrante o práctica los registra Formación o el mentor; aquí solo lo ves.</div>';
  html += '<section class="panel" style="padding:4px 16px 18px"><div class="form">'+
    '<label>Categoría (My.NFQ)<select data-act="wiz" data-k="categoria"'+(puede?'':' disabled')+'>'+opt(Object.keys(CAT2BANDA).map(c=>({id:c})), d.categoria, x=>x.id, 'Elegir')+'</select></label>'+
    '<label>Banda<select data-act="wiz" data-k="banda"'+(puede?'':' disabled')+'>'+opt(items('bandas'), d.banda, b=>b.nombre+' — '+b.categorias.join(', '), 'Elegir')+'</select></label>'+
    '<label>Cuadrante de cliente<select data-act="wiz" data-k="cuadrante"'+(puede?'':' disabled')+'>'+opt(items('cuadrantes'), d.cuadrante, c=>c.nombre+' ('+c.ug+')', 'Elegir')+'</select></label>'+
    '<label>Práctica principal<select data-act="wiz" data-k="practica"'+(puede?'':' disabled')+'>'+opt(items('practicas'), d.practica, x=>x.nombre, 'Elegir')+'</select></label>'+
    '<label>Práctica secundaria (opcional)<select data-act="wiz" data-k="practica2"'+(puede?'':' disabled')+'>'+opt(items('practicas').filter(x=>x.id!==d.practica), d.practica2, x=>x.nombre, 'Ninguna')+'</select></label>'+
    '<label>Mentor<select data-act="wiz" data-k="mentor"'+(esRF()?'':' disabled')+'>'+opt(Object.values(DB.personas).filter(x=>x.email!==email).map(x=>({id:x.email, n:x.nombre||x.email})), d.mentor, x=>x.n, 'Sin mentor')+'</select>'+(esRF()?'':'<span class="note">Lo asigna Formación.</span>')+'</label>'+
    '<label>Fecha de alta<input type="date" data-act="wiz" data-k="fecha_alta" value="'+esc(d.fecha_alta)+'"'+(puede?'':' disabled')+'></label>'+
    '<label>Proyecto actual<input data-act="wiz" data-k="proyecto" value="'+esc(d.proyecto)+'" placeholder="p. ej. BBVA CIB · ANS FX"'+(puede?'':' disabled')+'></label>'+
    '</div></section>';
  if(perfilCompleto(d)){
    html += '<section class="panel" style="margin-top:14px"><div class="capa-h"><h2>Vista previa de la ruta</h2><span class="note">'+(sit?nombreSit(sit):'Sin cambios en el perfil')+' · '+prev.length+' módulos · '+hrs(horasDe(prev))+(nuevos.length!==prev.length?' · '+nuevos.length+' nuevos':'')+'</span></div>';
    html += CAPAS.map(c => { const g = prev.filter(m=>m.capa===c); return g.length ? '<div class="prev-g"><h3>'+c+' <span class="note">'+hrs(horasDe(g))+'</span></h3>'+g.map(m=>'<span class="chip'+(DB.progreso[email+':'+m.id]?'':' hit')+'" title="'+esc(m.nombre)+'"><code>'+esc(m.id)+'</code> '+esc(m.nombre.split(' · ')[0])+' · '+hrs(m.horas)+'</span>').join('')+'</div>' : ''; }).join('');
    html += '<div class="actions" style="padding:12px 16px">'+(puede && sit ? '<button class="btn" data-act="wizsave">Guardar perfil y asignar '+esc(nombreSit(sit).toLowerCase())+'</button>' : puede ? '<button class="btn" data-act="wizsave">Guardar perfil</button>' : '')+'<span class="note">Los módulos en azul son nuevos; el resto ya están en la ruta.</span></div></section>';
  }
  return html;
}

/* --- Equipo --- */
function viewEquipo(){
  let list = personasVisibles().filter(p => p.email!==ME.email);
  const q = S.eq;
  if(q.cuad) list = list.filter(p => p.cuadrante===q.cuad); if(q.prac) list = list.filter(p => p.practica===q.prac || p.practica2===q.prac);
  if(q.q) list = list.filter(p => norm(p.nombre+' '+p.email).includes(norm(q.q)));
  const rows = list.map(p => ({p, R: perfilCompleto(p) ? resumen(p) : null}));
  if(q.pend) rows.splice(0, rows.length, ...rows.filter(x => x.R && x.R.porValidar));
  const porValidar = rows.reduce((n,x) => n+(x.R?x.R.porValidar:0), 0), sinPerfil = rows.filter(x=>!x.R).length;
  const opt = (items_, val, label) => '<option value="">Todos</option>'+items_.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===val?' selected':'')+'>'+esc(label(x))+'</option>').join('');
  let html = '<div class="head"><div><h1>Equipo</h1><p>Personas cuya formación ves: las que mentorizas'+(esRF()?', y toda la firma como Formación':tiene('rfun')?', y tu cuadrante':tiene('rfp')?', y tu práctica':'')+'.</p></div></div>';
  html += '<div class="kpis"><div class="kpi"><b class="num">'+rows.length+'</b><span>personas</span></div><div class="kpi"><b class="num">'+porValidar+'</b><span>evidencias por validar</span></div><div class="kpi"><b class="num">'+sinPerfil+'</b><span>sin perfil formativo</span></div><div class="kpi"><b class="num">'+rows.filter(x=>x.R&&x.R.oblPend).length+'</b><span>con obligatorios pendientes</span></div></div>';
  html += '<section class="panel" style="margin-top:14px"><div class="toolbar"><label class="field note">Cuadrante <select data-act="eq" data-k="cuad">'+opt(items('cuadrantes'), q.cuad, x=>x.nombre)+'</select></label><label class="field note">Práctica <select data-act="eq" data-k="prac">'+opt(items('practicas'), q.prac, x=>x.nombre)+'</select></label><label class="field note">Buscar <input data-act="eq" data-k="q" value="'+esc(q.q)+'" placeholder="nombre"></label><label class="check note"><input type="checkbox" data-act="eq" data-k="pend"'+(q.pend?' checked':'')+'> Solo con evidencias por validar</label></div>';
  html += '<div class="tablewrap"><table class="tbl"><thead><tr><th>Persona</th><th>Banda</th><th>Cuadrante</th><th>Práctica</th><th class="num">Cerrados</th><th class="num">Oblig. pend.</th><th class="num">Horas</th><th>Por validar</th><th>Última actividad</th></tr></thead><tbody>';
  html += rows.map(({p,R}) => '<tr><td><a href="#" data-act="verruta" data-id="'+esc(p.email)+'">'+esc(p.nombre||p.email)+'</a>'+(p.mentor===ME.email?' <span class="tag cvt">mentorizas</span>':'')+'</td><td>'+esc(p.banda?nombreBanda(p.banda):'—')+'</td><td>'+esc(p.cuadrante?nombreCuad(p.cuadrante):'—')+'</td><td>'+esc(p.practica?nombrePrac(p.practica):'—')+(p.practica2?' <span class="note">+ '+esc(nombrePrac(p.practica2))+'</span>':'')+'</td>'+
    (R ? '<td class="num">'+R.cerrados+'/'+R.modulos+'</td><td class="num">'+(R.oblPend?'<span class="pill crit">'+R.oblPend+'</span>':'0')+'</td><td class="num">'+hrs(R.hechas)+' <span class="note">/ '+hrs(R.plan)+'</span></td><td>'+(R.porValidar?'<a href="#" data-act="verruta" data-id="'+esc(p.email)+'" class="pill warn">'+R.porValidar+'</a>':'—')+'</td><td class="note">'+(R.ult?ftime(R.ult):'—')+'</td>'
       : '<td colspan="5"><span class="tag warn">Sin perfil</span> '+(editaPerfil(p)||esRF()?'<a href="#" data-act="tab" data-id="perfil" data-email="'+esc(p.email)+'">Completar</a>':'')+'</td>')+'</tr>').join('') || '<tr><td colspan="9" class="empty">Nadie con esos filtros.</td></tr>';
  html += '</tbody></table></div></section>';
  return html;
}

/* --- Catálogo --- */
function viewCatalogo(){
  const c = S.cat; let list = Object.values(DB.modulos);
  if(c.capa) list = list.filter(m => m.capa===c.capa);
  if(c.cuad) list = list.filter(m => m.capa!=='Cliente' || m.cuadrante===c.cuad); else if(!c.capa || c.capa==='Cliente') list = list.filter(m => m.capa!=='Cliente' || m.cuadrante===(items('cuadrantes')[0]||{}).id);
  if(c.prac) list = list.filter(m => m.capa!=='Práctica' || m.practica===c.prac); else list = list.filter(m => m.capa!=='Práctica' || m.practica===(items('practicas')[0]||{}).id);
  if(c.estado) list = list.filter(m => m.estado===c.estado);
  if(c.q) list = list.filter(m => norm(JSON.stringify(m)).includes(norm(c.q)));
  list.sort((a,b) => CAPAS.indexOf(a.capa)-CAPAS.indexOf(b.capa) || a.id.localeCompare(b.id));
  const all = Object.values(DB.modulos), porCrear = all.filter(m=>m.estado==='crear').length, adaptar = all.filter(m=>m.estado==='adaptar').length;
  const mios = all.filter(editaModulo).length;
  const opt = (items_, val, label, first) => '<option value="">'+esc(first)+'</option>'+items_.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===val?' selected':'')+'>'+esc(label(x))+'</option>').join('');
  let html = '<div class="head"><div><h1>Catálogo</h1><p>Los módulos del plan táctico, con su encaje en el SGC. Cliente y Práctica se muestran para un cuadrante y una práctica a la vez.</p></div><div class="actions"><span class="note">'+all.length+' módulos · <span class="tag stop">'+porCrear+' por crear</span> <span class="tag warn">'+adaptar+' a adaptar</span>'+(mios?' · editas '+mios:'')+'</span></div></div>';
  html += '<section class="panel"><div class="toolbar"><div class="subtabs" style="margin:0;border:0">'+[['','Todas'],...CAPAS.map(x=>[x,x])].map(([k,l])=>'<button class="subtab" data-act="cat" data-k="capa" data-v="'+k+'" aria-selected="'+(c.capa===k)+'">'+l+'</button>').join('')+'</div>'+
    '<label class="field note">Cuadrante <select data-act="catsel" data-k="cuad">'+opt(items('cuadrantes'), c.cuad, x=>x.nombre, nombreCuad((items('cuadrantes')[0]||{}).id)+' (por defecto)')+'</select></label><label class="field note">Práctica <select data-act="catsel" data-k="prac">'+opt(items('practicas'), c.prac, x=>x.nombre, nombrePrac((items('practicas')[0]||{}).id)+' (por defecto)')+'</select></label><label class="field note">Material <select data-act="catsel" data-k="estado"><option value="">Todo</option>'+Object.keys(MAT).map(k=>'<option value="'+k+'"'+(c.estado===k?' selected':'')+'>'+MAT[k][0]+'</option>').join('')+'</select></label><label class="field note">Buscar <input data-act="catsel" data-k="q" value="'+esc(c.q)+'" placeholder="norma, herramienta, texto"></label></div>';
  html += '<div class="tablewrap"><table class="tbl"><thead><tr><th>Id</th><th>Módulo</th><th>Capa</th><th>Bandas</th><th class="num">Horas</th><th>Bloque SGC</th><th>Responsable</th><th>Material</th><th></th></tr></thead><tbody>';
  html += list.map(m => '<tr><td><code>'+esc(m.id)+'</code></td><td><a href="#" data-act="modulo" data-id="'+esc(m.id)+'">'+esc(m.nombre)+'</a><div class="note">'+esc(m.objetivo)+'</div></td><td><span class="pill">'+esc(m.capa)+'</span></td><td>'+bandasTxt(m)+'</td><td class="num">'+hrs(m.horas)+'</td><td class="note">'+esc(m.bloque)+'</td><td class="note">'+esc((m.responsable||[]).join(', '))+(m.dueno?'<br>'+esc(m.dueno):'')+'</td><td><span class="tag '+MAT[m.estado][1]+'">'+MAT[m.estado][0]+'</span></td><td>'+(editaModulo(m)?'<button class="btn quiet sm" data-act="editmod" data-id="'+esc(m.id)+'">Editar</button>':'')+'</td></tr>').join('') || '<tr><td colspan="9" class="empty">Ningún módulo con esos filtros.</td></tr>';
  html += '</tbody></table></div></section>';
  // plan táctico: lo que falta por producir, por dueño
  const pend = all.filter(m => m.estado!=='existe' && (!c.capa || m.capa===c.capa));
  const byOwner = {}; pend.forEach(m => { const k = m.dueno || (m.responsable||[]).join('/') || '—'; (byOwner[k] = byOwner[k]||[]).push(m); });
  html += '<section class="panel" style="margin-top:14px"><div class="capa-h"><h2>Plan táctico: material pendiente por dueño</h2><span class="note">'+pend.length+' piezas · '+h(Object.keys(byOwner).length,'dueño','dueños')+'</span></div><div class="owners">'+Object.entries(byOwner).sort((a,b)=>b[1].length-a[1].length).map(([k,ms]) => '<div class="owner'+(/a nombrar/i.test(k)?' warn':'')+'"><b>'+esc(k)+'</b><span class="note">'+ms.filter(m=>m.estado==='crear').length+' por crear · '+ms.filter(m=>m.estado==='adaptar').length+' a adaptar</span><div class="chips">'+ms.slice(0,8).map(m=>'<a href="#" class="chip" data-act="modulo" data-id="'+esc(m.id)+'"><code>'+esc(m.id)+'</code></a>').join('')+(ms.length>8?'<span class="note">+'+(ms.length-8)+'</span>':'')+'</div></div>').join('')+'</div></section>';
  return html;
}
function bandasTxt(m){ return items('bandas').map(b => { const a = m.aplica && m.aplica[b.id]; return '<span class="bd'+(a?' '+a:' na')+'" title="'+esc(b.nombre+': '+(a?APL[a]:'no aplica'))+'">'+b.id+'</span>'; }).join(''); }

/* --- Seguimiento (Formación) --- */
function viewSeguimiento(){
  const pers = Object.values(DB.personas).filter(vePersona), conPerfil = pers.filter(perfilCompleto);
  const Rs = conPerfil.map(p => ({p, R:resumen(p)}));
  const conRuta = Rs.filter(x=>x.R.modulos).length;
  const horasMedia = Rs.length ? Rs.reduce((n,x)=>n+x.R.hechas,0)/Rs.length : 0;
  const oblPend = Rs.reduce((n,x)=>n+x.R.oblPend,0), porValidar = Rs.reduce((n,x)=>n+x.R.porValidar,0);
  const all = Object.values(DB.modulos), porCrear = all.filter(m=>m.estado==='crear').length;
  const sinDueno = [...new Set(all.filter(m => /a nombrar/i.test(m.dueno||'')).map(m=>m.dueno))].length;
  let html = '<div class="head"><div><h1>Seguimiento</h1><p>Cobertura del plan: quién tiene ruta, qué falta y qué material no existe. La matriz es la ocupación real de cuadrante × práctica: cada celda con personas es una ruta distinta que hay que servir.</p></div></div>';
  html += '<div class="kpis"><div class="kpi"><b class="num">'+conPerfil.length+' / '+pers.length+'</b><span>personas con perfil</span></div><div class="kpi"><b class="num">'+conRuta+'</b><span>con ruta asignada</span></div><div class="kpi"><b class="num">'+hrs(horasMedia)+'</b><span>media hecha por persona (objetivo 40 h)</span></div><div class="kpi"><b class="num">'+oblPend+'</b><span>obligatorios pendientes</span></div><div class="kpi"><b class="num">'+porValidar+'</b><span>evidencias por validar</span></div><div class="kpi"><b class="num">'+porCrear+'</b><span>módulos por crear</span></div><div class="kpi"><b class="num">'+sinDueno+'</b><span>dueños sin nombrar</span></div></div>';
  // matriz de ocupación
  const cu = items('cuadrantes'), pr = items('practicas');
  const cell = (c,p) => conPerfil.filter(x => x.cuadrante===c.id && (x.practica===p.id)).length;
  const celdas = cu.flatMap(c => pr.map(p => cell(c,p))).filter(n=>n>0).length;
  html += '<section class="panel" style="margin-top:14px"><div class="capa-h"><h2>Ocupación cuadrante × práctica</h2><span class="note">'+celdas+' rutas reales de '+(cu.length*pr.length)+' posibles (sin contar bandas)</span></div><div class="tablewrap"><table class="tbl matrix"><thead><tr><th>Cuadrante</th>'+pr.map(p=>'<th title="'+esc(p.nombre)+'">'+esc(p.id)+'</th>').join('')+'<th class="num">Total</th></tr></thead><tbody>';
  html += cu.map(c => '<tr><td><b>'+esc(c.nombre)+'</b></td>'+pr.map(p => { const n = cell(c,p); return '<td class="num'+(n?' on':'')+'">'+(n||'')+'</td>'; }).join('')+'<td class="num"><b>'+conPerfil.filter(x=>x.cuadrante===c.id).length+'</b></td></tr>').join('');
  html += '<tr><td><b>Total</b></td>'+pr.map(p=>'<td class="num"><b>'+conPerfil.filter(x=>x.practica===p.id).length+'</b></td>').join('')+'<td class="num"><b>'+conPerfil.length+'</b></td></tr></tbody></table></div><p class="note" style="padding:8px 16px 14px">Prácticas: '+pr.map(p=>p.id+' '+p.nombre).join(' · ')+'.</p></section>';
  // bandas
  html += '<section class="panel" style="margin-top:14px"><div class="capa-h"><h2>Por banda</h2></div><div class="tablewrap"><table class="tbl"><thead><tr><th>Banda</th><th class="num">Personas</th><th class="num">Horas plan media</th><th class="num">Horas hechas media</th><th class="num">Oblig. pendientes</th></tr></thead><tbody>'+items('bandas').map(b => { const g = Rs.filter(x=>x.p.banda===b.id); const avg = f => g.length ? g.reduce((n,x)=>n+f(x.R),0)/g.length : 0; return '<tr><td>'+esc(b.nombre)+'</td><td class="num">'+g.length+'</td><td class="num">'+hrs(avg(R=>R.plan))+'</td><td class="num">'+hrs(avg(R=>R.hechas))+'</td><td class="num">'+g.reduce((n,x)=>n+x.R.oblPend,0)+'</td></tr>'; }).join('')+'</tbody></table></div></section>';
  // módulos más pendientes
  const cnt = {}; Object.values(DB.progreso).forEach(r => { if(r.estado==='pendiente') cnt[r.modulo] = (cnt[r.modulo]||0)+1; });
  const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1]).slice(0,10);
  html += '<section class="panel" style="margin-top:14px"><div class="capa-h"><h2>Módulos con más personas pendientes</h2><span class="note">dónde conviene convocar primero</span></div><div class="tablewrap"><table class="tbl"><tbody>'+top.map(([id,n]) => { const m = DB.modulos[id]||{}; return '<tr><td><code>'+esc(id)+'</code></td><td><a href="#" data-act="modulo" data-id="'+esc(id)+'">'+esc(m.nombre||id)+'</a></td><td><span class="tag '+(MAT[m.estado]||['',''])[1]+'">'+(MAT[m.estado]||[''])[0]+'</span></td><td class="num"><b>'+n+'</b> personas</td></tr>'; }).join('')+'</tbody></table></div></section>';
  return html;
}

/* --- diálogos --- */
function openModulo(id){
  const m = DB.modulos[id]; if(!m) return; const dlg = document.getElementById('drawer');
  dlg.innerHTML = '<div class="dw"><div class="dw-top"><div><span class="eyebrow"><code>'+esc(m.id)+'</code> · '+esc(m.capa)+'</span><h2 id="dw-name">'+esc(m.nombre)+'</h2></div><button class="iconbtn" data-act="close" aria-label="Cerrar">×</button></div>'+
    '<p>'+esc(m.objetivo)+'</p><dl class="dl"><dt>Horas</dt><dd>'+hrs(m.horas)+(m.horasExternas?' · '+esc(m.horasExternas):'')+'</dd><dt>Bandas</dt><dd>'+bandasTxt(m)+'</dd><dt>Bloque SGC</dt><dd>'+esc(m.bloque)+'</dd><dt>Formato · canal</dt><dd>'+esc(m.formato)+' · '+esc(m.canal)+'</dd><dt>Evaluación</dt><dd>'+esc(m.evaluacion)+'</dd><dt>Responsable</dt><dd>'+esc((m.responsable||[]).map(r=>r+(cfg('roles')[r]?' ('+cfg('roles')[r]+')':'')).join('; '))+(m.dueno?'<br>'+esc(m.dueno):'')+'</dd><dt>Momento</dt><dd>'+esc(m.momento)+'</dd><dt>Situaciones</dt><dd>'+esc((m.eventos||[]).map(nombreSit).join(' · '))+'</dd><dt>Material</dt><dd><span class="tag '+MAT[m.estado][1]+'">'+MAT[m.estado][0]+'</span>'+((m.material||[]).length?'<br>'+esc(m.material.join('; ')):'')+'</dd></dl>'+
    '<h3 style="margin-top:14px">Contenido</h3><ul>'+(m.contenido||[]).map(c=>'<li>'+esc(c)+'</li>').join('')+'</ul>'+(m.actualizado?'<p class="note">Actualizado por '+esc(who(m.actualizado_por))+' el '+ftime(m.actualizado)+'</p>':'')+
    (editaModulo(m)?'<div class="actions" style="margin-top:14px"><button class="btn quiet" data-act="editmod" data-id="'+esc(m.id)+'">Editar ficha</button></div>':'')+'</div>';
  dlg.showModal();
}
function openEditModulo(id){
  const m = DB.modulos[id]; if(!m || !editaModulo(m)) return; const dlg = document.getElementById('editor'); document.getElementById('drawer').open && document.getElementById('drawer').close();
  dlg.innerHTML = '<form class="dw" method="dialog" data-mod="'+esc(id)+'"><div class="dw-top"><h2 id="ed-title">Editar '+esc(m.id)+'</h2><button class="iconbtn" data-act="close" type="button" aria-label="Cerrar">×</button></div><div class="form">'+
    '<label class="full">Nombre<input name="nombre" value="'+esc(m.nombre)+'" required></label><label class="full">Objetivo<textarea name="objetivo">'+esc(m.objetivo)+'</textarea></label>'+
    '<label>Horas<input name="horas" type="number" step="0.5" min="0" value="'+esc(m.horas)+'"></label><label>Material<select name="estado">'+Object.keys(MAT).map(k=>'<option value="'+k+'"'+(m.estado===k?' selected':'')+'>'+MAT[k][0]+'</option>').join('')+'</select></label>'+
    '<label>Dueño nominal<input name="dueno" value="'+esc(m.dueno||'')+'" placeholder="nombre o buzón"></label><label>Momento<input name="momento" value="'+esc(m.momento)+'"></label>'+
    '<label>Formato<input name="formato" value="'+esc(m.formato)+'"></label><label>Canal<input name="canal" value="'+esc(m.canal)+'"></label>'+
    '<label class="full">Contenido (una línea por punto)<textarea name="contenido" class="tall">'+esc((m.contenido||[]).join('\n'))+'</textarea></label><label class="full">Material existente (una línea por pieza)<textarea name="material">'+esc((m.material||[]).join('\n'))+'</textarea></label>'+
    '<div class="full">Bandas: '+items('bandas').map(b=>'<label style="display:inline-grid;margin-right:12px">'+esc(b.nombre)+'<select name="aplica_'+b.id+'"><option value="">No aplica</option>'+Object.keys(APL).map(k=>'<option value="'+k+'"'+((m.aplica||{})[b.id]===k?' selected':'')+'>'+APL[k]+'</option>').join('')+'</select></label>').join('')+'</div>'+
    '</div><div class="actions" style="margin-top:16px"><button class="btn" type="submit">Guardar</button><button class="btn quiet" type="button" data-act="close">Cancelar</button></div></form>';
  dlg.showModal();
  dlg.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target); const n = clone(m);
    n.nombre = String(f.get('nombre')||'').trim(); n.objetivo = String(f.get('objetivo')||'').trim(); n.horas = Number(f.get('horas')||0); n.estado = f.get('estado'); n.dueno = String(f.get('dueno')||'').trim()||null; n.momento = f.get('momento'); n.formato = f.get('formato'); n.canal = f.get('canal');
    n.contenido = String(f.get('contenido')||'').split('\n').map(s=>s.trim()).filter(Boolean); n.material = String(f.get('material')||'').split('\n').map(s=>s.trim()).filter(Boolean);
    n.aplica = {}; items('bandas').forEach(b => n.aplica[b.id] = f.get('aplica_'+b.id) || null);
    try{ await api.saveModulo(n); dlg.close(); render(); toast('Ficha guardada.'); }catch(err){ fail(err); }
  };
}
function openCompletar(id){
  const r = DB.progreso[id]; if(!r) return; const m = DB.modulos[r.modulo]||{}; const dlg = document.getElementById('editor');
  dlg.innerHTML = '<form class="dw" method="dialog"><div class="dw-top"><h2 id="ed-title">Marcar completado</h2><button class="iconbtn" data-act="close" type="button" aria-label="Cerrar">×</button></div><p><code>'+esc(m.id)+'</code> '+esc(m.nombre)+'</p><p class="note">Evaluación prevista: '+esc(m.evaluacion||'—')+'</p><div class="form">'+
    '<label>Fecha<input name="fecha" type="date" value="'+esc(r.fecha||today())+'"></label><label>Horas reales<input name="horas" type="number" step="0.5" min="0" value="'+esc(r.horas!=null?r.horas:(m.horas||0))+'"></label>'+
    '<label class="full">Evidencia<input name="evidencia" value="'+esc(r.evidencia||'')+'" placeholder="resultado del test, certificado, enlace a Classroom o Drive" required></label><label class="full">Nota<input name="nota" value="'+esc(r.nota||'')+'"></label></div>'+
    '<div class="actions" style="margin-top:16px"><button class="btn" type="submit">Guardar</button><button class="btn quiet" type="button" data-act="close">Cancelar</button></div></form>';
  dlg.showModal();
  dlg.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try{ await api.saveProgreso(Object.assign({}, r, {estado:'completado', fecha:f.get('fecha'), horas:Number(f.get('horas')||0), evidencia:String(f.get('evidencia')||'').trim(), nota:String(f.get('nota')||'').trim()||null})); dlg.close(); render(); toast('Módulo completado.'); }catch(err){ fail(err); }
  };
}

/* ---------- eventos ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]'); if(!t) return; const a = t.dataset.act, id = t.dataset.id;
  if(t.tagName==='A') e.preventDefault();
  if(a==='tab'){ S.view = id; if(t.dataset.email){ S.wiz.email = t.dataset.email; S.wiz.draft = null; } render(); window.scrollTo({top:0}); }
  else if(a==='capa'){ S.capa = id; render(); }
  else if(a==='verruta'){ S.person = id; S.view = 'ruta'; render(); window.scrollTo({top:0}); }
  else if(a==='modulo'){ openModulo(id); }
  else if(a==='editmod'){ openEditModulo(id); }
  else if(a==='completar'){ openCompletar(id); }
  else if(a==='estado'){ const r = DB.progreso[id]; if(!r) return; try{ await api.saveProgreso(Object.assign({}, r, {estado:t.dataset.estado, validado_por: t.dataset.estado==='pendiente' ? null : r.validado_por})); render(); toast(ESTADOS[t.dataset.estado]+'.'); }catch(err){ fail(err); } }
  else if(a==='validar'){ const r = DB.progreso[id]; if(!r) return; try{ await api.saveProgreso(Object.assign({}, r, {estado:'completado', validado_por:ME.email})); render(); toast('Evidencia validada.'); }catch(err){ fail(err); } }
  else if(a==='asignar'){ try{ const n = await api.asignar(id, t.dataset.tipo, today()); render(); toast(n ? h(n,'módulo asignado','módulos asignados')+'.' : 'Nada nuevo que asignar.'); }catch(err){ fail(err); } }
  else if(a==='cat'){ S.cat[t.dataset.k] = t.dataset.v; render(); }
  else if(a==='wizsave'){ const d = S.wiz.draft; if(!d) return; const patch = {categoria:d.categoria||null, banda:d.banda, cuadrante:d.cuadrante, practica:d.practica, practica2:d.practica2||null, proyecto:d.proyecto||null, fecha_alta:d.fecha_alta||null}; if(esRF()) patch.mentor = d.mentor||null; try{ await api.savePerfil(d.email, patch); S.person = d.email; S.view = 'ruta'; S.wiz.draft = null; render(); toast('Perfil guardado y ruta asignada.'); }catch(err){ fail(err); } }
  else if(a==='close'){ const d = t.closest('dialog'); d && d.close(); }
  else if(a==='signin'){ api.signIn(); }
  else if(a==='signout'){ api.signOut(); }
  else if(a==='user'){ if(DEMO) toast('Modo demo: datos ficticios, nada se guarda.'); else api.signOut(); }
  else if(a==='home'){ S.view = 'ruta'; S.person = null; render(); }
});
document.addEventListener('change', e => {
  const t = e.target.closest('[data-act]'); if(!t) return; const a = t.dataset.act;
  if(a==='wiz'){ const k = t.dataset.k; S.wiz.draft[k] = t.type==='checkbox' ? t.checked : t.value; if(k==='categoria' && CAT2BANDA[t.value]) S.wiz.draft.banda = CAT2BANDA[t.value]; if(k==='practica' && S.wiz.draft.practica2===t.value) S.wiz.draft.practica2 = ''; render(); }
  else if(a==='wizperson'){ S.wiz.email = t.value; S.wiz.draft = null; render(); }
  else if(a==='eq'){ S.eq[t.dataset.k] = t.type==='checkbox' ? t.checked : t.value; render(); }
  else if(a==='catsel'){ S.cat[t.dataset.k] = t.value; render(); }
});
document.addEventListener('input', e => { const t = e.target.closest('input[data-act="eq"][data-k="q"],input[data-act="catsel"][data-k="q"],input[data-act="wiz"]'); if(!t) return; if(t.dataset.act==='eq'){ S.eq.q = t.value; } else if(t.dataset.act==='catsel'){ S.cat.q = t.value; } else { S.wiz.draft[t.dataset.k] = t.value; return; } clearTimeout(S._t); S._t = setTimeout(() => { const pos = t.selectionStart; render(); const n = document.querySelector('input[data-act="'+t.dataset.act+'"][data-k="q"]'); if(n){ n.focus(); try{ n.setSelectionRange(pos,pos); }catch(_){} } }, 200); });
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if(e.target===d) d.close(); }));

/* ---------- arranque ---------- */
try{ const hsh = (location.hash||'').replace('#',''); if(['ruta','perfil','equipo','catalogo','seguimiento'].includes(hsh)) S.view = hsh; }catch(_){}
render();
api.load().then(() => { if(S.view==='catalogo' && !S.cat.cuad){ /* defaults ya en vista */ } render(); }).catch(e => { DB.loading = false; DB.err = e.message||String(e); AUTH.state = AUTH.state==='init' ? 'out' : AUTH.state; render(); console.error(e); });
})();
