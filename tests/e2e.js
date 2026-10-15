// Prueba de extremo a extremo con Supabase y Google Drive simulados.
// Uso: node tests/e2e.js <carpeta-capturas> <carpeta-mocks con base.xlsx, client.xlsx, mock-supabase.js>
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out, mockDir] = process.argv.slice(2);
  const BASE = 'http://127.0.0.1:8765/';
  const files = { '1vl6gUv61mpeEDCwqU5Bsgi5CyJXI3upDYeGsGNdRA2Y': ['Recruiting-Sr Seguros/ Data / IA', fs.readFileSync(mockDir + '/base.xlsx')], '1B3GFedS6c1ZY0lMYW4zqTqVgLbmTz-S-_0F0o4sS7bY': ['Recruiting Senior BBVA CF F&R', fs.readFileSync(mockDir + '/client.xlsx')] };
  const browser = await chromium.launch();
  const errs = [], csp = [];
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  let expired = false;
  await ctx.route('**/vendor/supabase.js', r => r.fulfill({ path: mockDir + '/mock-supabase.js', contentType: 'application/javascript' }));
  await ctx.route('**/config.js', r => r.fulfill({ body: "window.TALENTO_CONFIG={supabaseUrl:'https://test.supabase.co',supabaseAnonKey:'anon',allowedDomain:'nfq.es',ug:'UG02'};", contentType: 'application/javascript' }));
  await ctx.addInitScript("window.__MOCK_SEED={miembros:[{email:'marcos.rodriguez@nfq.es',nombre:'Marcos Rodríguez',rol:'admin',ug:'UG02'}],fuentes:[{id:'UG02',ug:'UG02',data:{base:{id:'1vl6gUv61mpeEDCwqU5Bsgi5CyJXI3upDYeGsGNdRA2Y',name:'Recruiting-Sr Seguros/ Data / IA'},clients:[{id:'1B3GFedS6c1ZY0lMYW4zqTqVgLbmTz-S-_0F0o4sS7bY',name:'Recruiting Senior BBVA CF F&R'}],filtro:'BBVA',unidad:'UG 02 · BBVA'}}]};");
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ body: '', contentType: 'text/css' }));
  await ctx.route('https://www.googleapis.com/**', r => {
    if (expired) return r.fulfill({ status: 401, body: '{}' });
    const u = new URL(r.request().url()), id = decodeURIComponent(u.pathname.split('/')[4]);
    if (!files[id]) return r.fulfill({ status: 404, body: '{}' });
    if (u.pathname.endsWith('/export')) return r.fulfill({ status: 200, body: files[id][1], contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
    return r.fulfill({ status: 200, body: JSON.stringify({ name: files[id][0], mimeType: 'application/vnd.google-apps.spreadsheet' }), contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } });
  });
  const p = await ctx.newPage();
  p.on('console', m => { const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) csp.push(t); else if (m.type() === 'error') errs.push(t); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  const log = (...a) => console.log(...a);
  const as = async (email, gtokenOff) => { await p.evaluate(([e, g]) => { localStorage.setItem('__mock_email', e); if (g) sessionStorage.setItem('__mock_gt', '1'); else sessionStorage.removeItem('__mock_gt'); sessionStorage.removeItem('talento.gtoken'); }, [email, gtokenOff]); await p.reload(); if (await p.waitForSelector('.tab[data-id=needs]:not([disabled])', { timeout: 6000 }).then(() => true, () => false)) { await p.click('.tab[data-id=needs]'); await p.waitForTimeout(300); } else await p.waitForTimeout(300); };

  await p.goto(BASE); await p.waitForTimeout(500);
  log('1 login:', await p.locator('.connect h1').innerText()); await p.screenshot({ path: out + '/1-login.png' });
  await p.click('[data-act=signin]'); await p.waitForSelector('.item', { timeout: 20000 }); await p.waitForTimeout(500);
  log('2 admin dentro:', (await p.locator('.head p').first().innerText()).slice(0, 90), '| tabs:', (await p.locator('#tabs').innerText()).replace(/\s+/g, ' '));
  await p.screenshot({ path: out + '/2-needs.png' });
  await p.uncheck('#scope'); await p.waitForTimeout(200); log('   sin ámbito:', (await p.locator('.head p').first().innerText()).slice(0, 60)); await p.check('#scope'); await p.waitForTimeout(200);
  // equipo
  await p.click('#datosbtn'); await p.waitForTimeout(200);
  await p.fill('#memform [name=email]', 'pepe@gmail.com'); await p.click('#memform button[type=submit]'); await p.waitForTimeout(100);
  log('3 alta gmail:', await p.locator('#memmsg').innerText());
  for (const [e, n, r] of [['editora@nfq.es', 'Eva Editora', 'editor'], ['lector@nfq.es', 'Luis Lector', 'lector']]) { await p.fill('#memform [name=email]', e); await p.fill('#memform [name=nombre]', n); await p.selectOption('#memform [name=rol]', r); await p.click('#memform button[type=submit]'); await p.waitForTimeout(250); }
  log('   equipo:', await p.locator('#datos tbody tr').count(), 'miembros');
  await p.click('[data-act=audit]'); await p.waitForTimeout(200);
  await p.screenshot({ path: out + '/3-datos.png' });
  await p.click('[data-act=closedatos]');
  // necesidad nueva, funnel
  await p.click('[data-act=newneed]'); await p.fill('#edform [name=titulo]', 'Consultor/a senior de riesgo de crédito'); await p.fill('#edform [name=sector]', 'Banca'); await p.fill('#edform [name=cuenta]', 'BBVA / CIB'); await p.fill('#ed-desc', 'IFRS 9, IRB, SQL, inglés'); await p.click('#edform button[type=submit]'); await p.waitForTimeout(400);
  log('4 necesidad:', await p.locator('#needDetail h2').innerText());
  await p.locator('.rank [data-act=addfun]').first().click(); await p.waitForTimeout(300);
  await p.click('.tab[data-id=funnel]'); await p.waitForTimeout(300);
  const cols = async () => (await p.locator('.col-head').allInnerTexts()).map(h => h.replace(/\n/g, ':')).join(' | ');
  log('   funnel:', await cols());
  // cambio de otra persona en directo
  await p.evaluate(() => { const k = Object.keys(JSON.parse(localStorage.getItem('__mock_sb')).tables.funnel.reduce((a, r) => (a[r.id] = 1, a), {}))[0]; const row = JSON.parse(localStorage.getItem('__mock_sb')).tables.funnel[0]; window.__mockWrite('funnel', { id: row.id, ug: 'UG02', data: Object.assign({}, row.data, { etapa: 'Entrevista' }), actualizado: new Date().toISOString(), actualizado_por: 'editora@nfq.es' }); });
  await p.waitForTimeout(400); log('5 tras cambio de otra persona:', await cols());
  await p.screenshot({ path: out + '/4-funnel.png' });
  // lector
  await as('lector@nfq.es'); await p.waitForSelector('.item', { timeout: 20000 }); await p.waitForTimeout(400);
  log('6 lector banner:', await p.locator('.banner-soft').first().innerText(), '| botón nueva visible:', await p.locator('[data-act=newneed]').isVisible());
  const before = await p.evaluate(() => JSON.parse(localStorage.getItem('__mock_sb')).tables.necesidades.length);
  await p.evaluate(() => document.querySelector('[data-act=needfield][data-f=prioridad]').dispatchEvent(new Event('change', { bubbles: true })));
  await p.waitForTimeout(200); log('   escritura bloqueada:', before === await p.evaluate(() => JSON.parse(localStorage.getItem('__mock_sb')).tables.necesidades.length), '| aviso:', await p.locator('#toast').innerText());
  await p.screenshot({ path: out + '/5-lector.png' });
  // sin acceso
  await as('nuevo@nfq.es'); log('7 no miembro:', await p.locator('.connect h1').innerText());
  await as('alguien@gmail.com'); log('8 externo:', await p.locator('.connect .lead').innerText());
  await p.screenshot({ path: out + '/6-denied.png' });
  // token de Drive caducado
  await as('editora@nfq.es'); await p.waitForSelector('.item', { timeout: 20000 });
  expired = true; await p.click('#datosbtn'); await p.waitForTimeout(150); await p.click('#datos [data-act=reload]'); await p.waitForTimeout(500);
  log('9 drive caducado:', await p.locator('#datosbtn').innerText(), '|', (await p.locator('#datos .errbox').first().innerText().catch(() => '')).slice(0, 80));
  await p.keyboard.press('Escape'); expired = false;
  await p.emulateMedia({ colorScheme: 'dark' }); await p.click('.tab[data-id=pool]'); await p.waitForTimeout(300);
  await p.screenshot({ path: out + '/7-pool-dark.png' });
  await p.setViewportSize({ width: 390, height: 820 }); await p.click('.tab[data-id=needs]'); await p.waitForTimeout(300);
  log('10 móvil sin scroll lateral:', !(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  await p.screenshot({ path: out + '/8-mobile.png' });
  log('CSP:', JSON.stringify(csp.slice(0, 5)));
  log('errores:', JSON.stringify(errs.filter(e => !/401|404/.test(e)).slice(0, 8)));
  await browser.close();
})();
