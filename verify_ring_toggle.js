// Verify the dispatch zone rings follow the Rate Zone toggle.
// Pasco (Local 82) -> Morrow County OR (Local 36). Rings must show Local 82's
// zones by default, Local 36's after toggling, and revert on a new dispatch.
const puppeteer = require('puppeteer-core');
const EXE = process.env.CHROME || '/usr/bin/chromium-browser';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ringState() {
  // Read the rings the way a user sees them: every dashed dispatch circle on the map.
  const circles = [];
  window.subwattMap.eachLayer(l => {
    if (l.getRadius && l.options && l.options.className === 'zone-ring') circles.push({ mi: Math.round(l.getRadius() / 1609.34), tip: String(l.getTooltip ? l.getTooltip().getContent() : '').replace(/<[^>]+>/g, '') });
  });
  circles.sort((a, b) => a.mi - b.mi);
  const pressed = Array.from(document.querySelectorAll('#rate-toggle button')).filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent.trim());
  return { pressed, circles: circles.length, drawnRadii: circles.map(c => c.mi).join(','), labels: circles.map(c => c.tip) };
}
const clickToggle = n => { const b = Array.from(document.querySelectorAll('#rate-toggle button')).find(x => x.textContent.includes('Local ' + n)); if (!b) return 'NO_BUTTON'; b.click(); return 'ok'; };
const clickDispatch = (localId, frag) => { const h = document.querySelector('.lrow[data-local="' + localId + '"] .lrow-head'); if (h) h.click(); let t = null; document.querySelectorAll('.lrow[data-local="' + localId + '"] .dp-btn').forEach(b => { if ((b.getAttribute('data-dp-name') || '').toLowerCase().includes(frag)) t = b; }); if (!t) return 'NO_DISPATCH'; t.click(); return 'ok'; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.subwattMap && window.LOCALS && document.querySelectorAll('.dp-btn').length > 0, { timeout: 40000 }).catch(() => {});
  await sleep(1500);
  await page.evaluate(() => { let t = null; window.subwattMap.eachLayer(l => { if (t) return; if (l.feature && String(l.feature.id) === '41049') t = l; if (l.eachLayer) l.eachLayer(s => { if (!t && s.feature && String(s.feature.id) === '41049') t = s; }); }); if (t) t.fire('click', { latlng: t.getBounds().getCenter() }); });
  await sleep(3000);
  const r = {};
  r.click = await page.evaluate(clickDispatch, 82, 'pasco'); await sleep(3500);
  r.dispatchDefault = await page.evaluate(ringState);
  r.t36 = await page.evaluate(clickToggle, 36); await sleep(800);
  r.afterToggle36 = await page.evaluate(ringState);
  await page.screenshot({ path: '/tmp/ring_toggle_36.png' });
  await page.evaluate(clickToggle, 82); await sleep(800);
  r.afterToggle82 = await page.evaluate(ringState);
  await page.evaluate(clickToggle, 36); await sleep(500);
  await page.evaluate(clickDispatch, 82, 'spokane'); await sleep(3500);
  r.afterNewDispatch = await page.evaluate(ringState);
  console.log(JSON.stringify({ r, errors }, null, 1));
  const ok = [];
  const c = (n, v) => ok.push([n, !!v]);
  const A = r.dispatchDefault.drawnRadii, B = r.afterToggle36.drawnRadii;
  c('rings are drawn', r.dispatchDefault.circles > 0 && r.afterToggle36.circles > 0);
  c('default: Local 82 segment pressed', r.dispatchDefault.pressed.join().includes('82'));
  c('toggle->36: Local 36 segment pressed', r.afterToggle36.pressed.join().includes('36'));
  c('toggle->36: rings CHANGED to a different zone set', A !== B);
  c('toggle->82: rings back to the original set', r.afterToggle82.drawnRadii === A);
  c('new dispatch: rings reset to dispatch-local set', r.afterNewDispatch.drawnRadii === A);
  c('no stacked rings after toggling back', r.afterToggle82.circles === r.dispatchDefault.circles && r.afterNewDispatch.circles === r.dispatchDefault.circles);
  c('no page errors', errors.length === 0);
  ok.forEach(([n, p]) => console.log((p ? 'PASS ' : 'FAIL ') + n));
  await browser.close();
  process.exit(ok.every(x => x[1]) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
