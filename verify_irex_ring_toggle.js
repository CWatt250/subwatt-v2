// Irex Boise -> Baker County OR (Local 69 | Local 36). Clicking the existing Rates
// toggle must swap the rings to that local's zones and must NOT touch the route.
const puppeteer = require('puppeteer-core');
const EXE = process.env.CHROME || '/usr/bin/chromium-browser';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rings = () => { const c = []; window.subwattMap.eachLayer(l => { if (l.getRadius && l.options && l.options.className === 'zone-ring') c.push(Math.round(l.getRadius() / 1609.34) + ' ' + String(l.getTooltip().getContent()).replace(/<[^>]+>/g, '').split(' —')[0]); }); return c.sort((a, b) => parseInt(a) - parseInt(b)); };
const routeInfo = () => { const r = []; window.subwattMap.eachLayer(l => { if (l.__subwattRoute) r.push(l); }); if (!window.__r0) window.__r0 = r; return { count: r.length, sameObjects: r.length === window.__r0.length && r.every((x, i) => x === window.__r0[i]), onMap: r.every(x => window.subwattMap.hasLayer(x)) }; };
const pressed = () => Array.from(document.querySelectorAll('#rate-toggle button')).filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim()).join();
const segs = () => Array.from(document.querySelectorAll('#rate-toggle button')).map(b => b.textContent.trim()).join(' | ');
const clickToggle = n => { const b = Array.from(document.querySelectorAll('#rate-toggle button')).find(x => x.textContent.includes('Local ' + n)); if (!b) return 'NO_BUTTON'; b.click(); return 'ok'; };
const miles = () => document.getElementById('calc-mi') && document.getElementById('calc-mi').value;
const cost = () => { const o = document.getElementById('calc-out'); return o ? (o.textContent.match(/\$[\d,]+(?:\.\d+)?/) || [null])[0] : null; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.subwattMap && document.querySelectorAll('.dp-btn').length > 0, { timeout: 40000 });
  await sleep(1500);
  // destination: Baker County OR (41001)
  await page.evaluate(() => { let t = null; window.subwattMap.eachLayer(l => { if (t) return; if (l.feature && String(l.feature.id) === '41001') t = l; if (l.eachLayer) l.eachLayer(s => { if (!t && s.feature && String(s.feature.id) === '41001') t = s; }); }); if (t) t.fire('click', { latlng: L.latLng(44.3513, -117.2693) }); });
  await sleep(3000);
  // Irex Boise as the dispatch (read its id out of the branch popup's onclick)
  const used = await page.evaluate(() => { window.toggleIrex(); let id = null; window.subwattMap.eachLayer(l => { if (id || !l.getPopup || !l.getPopup()) return; const c = l.getPopup().getContent(); const h = typeof c === 'string' ? c : (c && c.outerHTML) || ''; if (/boise/i.test(h)) { const m = h.match(/useIrexAsDispatch\(['"&quot;]*([^'")&]+)/); if (m) id = m[1]; } }); if (id) window.useIrexAsDispatch(Number(id)); return id; });
  await sleep(4000);
  const s = {};
  s.used = used;
  s.segments = await page.evaluate(segs);
  s.start = { pressed: await page.evaluate(pressed), rings: await page.evaluate(rings), miles: await page.evaluate(miles), cost: await page.evaluate(cost), route: await page.evaluate(routeInfo) };
  await page.evaluate(clickToggle, 36); await sleep(800);
  s.toggled36 = { pressed: await page.evaluate(pressed), rings: await page.evaluate(rings), miles: await page.evaluate(miles), cost: await page.evaluate(cost), route: await page.evaluate(routeInfo) };
  await page.screenshot({ path: '/tmp/irex_ring_36.png' });
  await page.evaluate(clickToggle, 69); await sleep(800);
  s.back69 = { pressed: await page.evaluate(pressed), rings: await page.evaluate(rings), miles: await page.evaluate(miles), cost: await page.evaluate(cost), route: await page.evaluate(routeInfo) };
  console.log(JSON.stringify({ s, errors }, null, 1));
  const ok = []; const c = (n, v) => ok.push([n, !!v]);
  c('found Irex Boise branch and dispatched', used);
  c('toggle shows Local 69 | Local 36 and starts on 69', s.start.pressed.includes('69'));
  c('start rings = Local 69 table (has $150 subsistence ring)', s.start.rings.some(x => /150/.test(x)));
  c('toggle->36: pressed 36', s.toggled36.pressed.includes('36'));
  c('toggle->36: rings now Local 36 table (has $85 + $160, no $150)', s.toggled36.rings.some(x => /160/.test(x)) && s.toggled36.rings.some(x => /85/.test(x)) && !s.toggled36.rings.some(x => /\$150/.test(x)));
  c('toggle->36: cost changed (rate card still works)', s.toggled36.cost !== s.start.cost);
  c('toggle->36: miles unchanged', s.toggled36.miles === s.start.miles);
  c('route NOT redrawn (same layer objects, still on map)', s.toggled36.route.sameObjects && s.toggled36.route.onMap && s.back69.route.sameObjects);
  c('toggle->69: rings back to Local 69 table', JSON.stringify(s.back69.rings) === JSON.stringify(s.start.rings));
  c('toggle->69: cost back to start', s.back69.cost === s.start.cost);
  c('no page errors', errors.length === 0);
  ok.forEach(([n, p]) => console.log((p ? 'PASS ' : 'FAIL ') + n));
  await browser.close(); process.exit(ok.every(x => x[1]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
