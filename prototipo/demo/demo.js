// Prototipo: semilla de datos, Drive simulado y banda de demo. No hay servidor real.
(function(){
  var BASE = '1vl6gUv61mpeEDCwqU5Bsgi5CyJXI3upDYeGsGNdRA2Y', CLI = '1B3GFedS6c1ZY0lMYW4zqTqVgLbmTz-S-_0F0o4sS7bY';
  window.__MOCK_SEED = {
    miembros: [
      {email:'marcos.rodriguez@nfq.es', nombre:'Marcos Rodríguez', rol:'admin', ug:'UG02'},
      {email:'editor.demo@nfq.es', nombre:'Editora Demo', rol:'editor', ug:'UG02'},
      {email:'lector.demo@nfq.es', nombre:'Lector Demo', rol:'lector', ug:'UG02'}
    ],
    fuentes: [{id:'UG02', ug:'UG02', data:{base:{id:BASE, name:'Recruiting (demo · datos ficticios)'}, clients:[{id:CLI, name:'Cliente BBVA (demo)'}], filtro:'BBVA', unidad:'UG 02 · BBVA'}}]
  };
  var FILES = {}; FILES[BASE] = ['Recruiting (demo · datos ficticios)', 'demo/base.xlsx']; FILES[CLI] = ['Cliente BBVA (demo)', 'demo/client.xlsx'];
  var realFetch = window.fetch.bind(window);
  window.fetch = function(url, opts){
    var u = String(url && url.url || url);
    var m = u.match(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/?]+)(\/export)?/);
    if(!m) return realFetch(url, opts);
    var f = FILES[decodeURIComponent(m[1])];
    if(!f) return Promise.resolve(new Response('{}', {status:404}));
    if(/fields=/.test(u) && !m[2]) return Promise.resolve(new Response(JSON.stringify({name:f[0], mimeType:'application/vnd.google-apps.spreadsheet', modifiedTime:new Date().toISOString()}), {status:200, headers:{'Content-Type':'application/json'}}));
    return realFetch(f[1], {cache:'no-cache'});
  };
})();
// Servidor simulado en el navegador (solo prototipo).
(function(){
  const K = '__mock_sb';
  const load = () => { try { return JSON.parse(localStorage.getItem(K)) || null; } catch (_) { return null; } };
  const save = s => localStorage.setItem(K, JSON.stringify(s));
  let S = load() || { tables: { miembros: [], fuentes: [], necesidades: [], ofertas: [], funnel: [], pool: [], auditoria: [] } };
  const seed = window.__MOCK_SEED || {};
  if (!load()) { S.tables.miembros = seed.miembros || []; S.tables.fuentes = seed.fuentes || []; save(S); }
  const email = () => localStorage.getItem('__mock_email') || '';
  const rol = () => { const m = S.tables.miembros.find(x => x.email === email()); return m && m.rol; };
  const listeners = [];
  const emit = (table, eventType, row, old) => listeners.forEach(l => { if (l.table === table) l.cb({ eventType, new: row || {}, old: old || {} }); });
  const audit = (tabla, doc_id, accion) => S.tables.auditoria.push({ tabla, doc_id, accion, por: email(), cuando: new Date().toISOString() });
  function q(table) {
    let filters = [], single = false, op = 'select', payload = null, lim = null;
    const api = {
      select() { return api; }, order() { return api; }, limit(n) { lim = n; return api; },
      eq(c, v) { filters.push([c, v]); return api; }, maybeSingle() { single = true; return api; },
      upsert(o) { op = 'upsert'; payload = o; return api; }, insert(o) { op = 'insert'; payload = o; return api; },
      update(o) { op = 'update'; payload = o; return api; }, delete() { op = 'delete'; return api; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      const T = S.tables[table]; const r = rol();
      const match = x => filters.every(([c, v]) => x[c] === v);
      if (op === 'select') {
        if (!r) return { data: single ? null : [], error: null };
        if (table === 'auditoria' && r !== 'admin') return { data: [], error: null };
        let d = T.filter(match); if (table === 'auditoria') d = d.slice().reverse(); if (lim) d = d.slice(0, lim);
        return { data: single ? (d[0] || null) : JSON.parse(JSON.stringify(d)), error: null };
      }
      const docs = ['necesidades', 'ofertas', 'funnel', 'pool'];
      const okWrite = table === 'miembros' || table === 'fuentes' ? r === 'admin' : (r === 'admin' || r === 'editor');
      if (!okWrite) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      if (table === 'miembros') {
        if (op === 'insert') { if (!/^[a-z0-9._%+-]+@nfq\.es$/.test(payload.email)) return { error: { code: '23514', message: 'check' } }; if (T.find(x => x.email === payload.email)) return { error: { code: '23505', message: 'dup' } }; T.push(Object.assign({ rol: 'lector', ug: 'UG02' }, payload)); }
        if (op === 'update') T.filter(match).forEach(x => Object.assign(x, payload));
        if (op === 'delete') { const t = T.filter(match); if (t.some(x => x.rol === 'admin') && T.filter(x => x.rol === 'admin').length <= 1) return { error: { code: 'P0001', message: 'Debe quedar al menos un administrador' } }; S.tables.miembros = T.filter(x => !match(x)); }
        save(S); emit('miembros', 'UPDATE', {}); return { data: null, error: null };
      }
      if (op === 'upsert') {
        const row = { id: payload.id, ug: payload.ug, data: payload.data, actualizado: new Date().toISOString(), actualizado_por: email() };
        const i = T.findIndex(x => x.id === payload.id); const isNew = i < 0; if (isNew) T.push(row); else T[i] = row;
        audit(table, payload.id, isNew ? 'alta' : 'cambio'); save(S); setTimeout(() => emit(table, isNew ? 'INSERT' : 'UPDATE', row), 30);
      }
      if (op === 'delete') { const gone = T.filter(match); S.tables[table] = T.filter(x => !match(x)); gone.forEach(g => audit(table, g.id, 'baja')); save(S); gone.forEach(g => setTimeout(() => emit(table, 'DELETE', null, { id: g.id }), 30)); }
      return { data: null, error: null };
    }
    return api;
  }
  window.__mockWrite = (table, row) => { S.tables[table].push(row); save(S); emit(table, 'INSERT', row); };
  window.supabase = { createClient() { return {
    auth: {
      async getSession() { const e = email(); return { data: { session: e ? { user: { email: e }, provider_token: sessionStorage.getItem('__mock_gt') ? null : 'gtok-1' } : null } }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOAuth() { localStorage.setItem('__mock_email', localStorage.getItem('__mock_next') || 'marcos.rodriguez@nfq.es'); sessionStorage.removeItem('__mock_gt'); location.reload(); },
      async signOut() { localStorage.removeItem('__mock_email'); }
    },
    from: q,
    channel() { const ch = { on(_e, f, cb) { listeners.push({ table: f.table, cb }); return ch; }, subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 10); return ch; } }; return ch; }
  }; } };
})();
(function(){
  function band(){
    var who = localStorage.getItem('__mock_email') || '';
    var b = document.createElement('div');
    b.setAttribute('role', 'note');
    b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:8px 12px;border-radius:10px;background:#100D25;color:#fff;font:12px/1.3 "Instrument Sans",system-ui,sans-serif;box-shadow:0 6px 20px rgba(16,13,37,.25)';
    b.innerHTML = '<strong style="font-weight:600">Prototipo</strong><span style="opacity:.8">Datos ficticios · sin servidor · los cambios se guardan solo en este navegador</span>';
    if(who){
      var s = document.createElement('select');
      s.setAttribute('aria-label', 'Ver la app como');
      s.style.cssText = 'font:inherit;color:#100D25;background:#fff;border-radius:6px;border:0;padding:3px 6px';
      [['marcos.rodriguez@nfq.es','Ver como admin'],['editor.demo@nfq.es','Ver como editor'],['lector.demo@nfq.es','Ver como lector']].forEach(function(o){ var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; if(o[0]===who) op.selected = true; s.appendChild(op); });
      s.addEventListener('change', function(){ localStorage.setItem('__mock_email', s.value); location.reload(); });
      b.appendChild(s);
    }
    var r = document.createElement('button');
    r.type = 'button'; r.textContent = 'Reiniciar demo';
    r.style.cssText = 'font:inherit;color:#fff;background:#217BEE;border:0;border-radius:6px;padding:4px 10px;cursor:pointer';
    r.addEventListener('click', function(){ ['__mock_sb','__mock_email'].forEach(function(k){ localStorage.removeItem(k); }); try{ sessionStorage.clear(); }catch(_){} location.reload(); });
    b.appendChild(r);
    document.body.appendChild(b);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', band); else band();
})();
