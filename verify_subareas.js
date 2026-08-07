// Verify the CBA sub-territory build-out across Locals 73 / 69 / 16 / 76 / 28.
// Drives the app through the DOM like a real user; converts lat/lng to screen
// pixels via window.subwattMap for precise county clicks.
const puppeteer = require('puppeteer-core');

const EXE = process.env.CHROME || '/usr/bin/chromium-browser';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let page;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? ' PASS ' : ' FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
}

async function clickLatLng(lat, lng, zoom) {
  await page.evaluate(([la, ln, z]) => { window.subwattMap.setView([la, ln], z || 8, { animate: false }); }, [lat, lng, zoom]);
  await sleep(700);
  const pt = await page.evaluate(([la, ln]) => {
    const p = window.subwattMap.latLngToContainerPoint([la, ln]);
    const r = document.getElementById('map').getBoundingClientRect();
    return { x: r.x + p.x, y: r.y + p.y };
  }, [lat, lng]);
  await page.mouse.click(pt.x, pt.y);
  await sleep(2200); // route fetch + calc render
}

async function readCard() {
  return page.evaluate(() => {
    const rc = document.getElementById('rc');
    const out = document.getElementById('calc-out');
    return {
      card: rc ? rc.textContent : '',
      calc: out ? out.textContent : '',
      county: (document.getElementById('sbm') || {}).textContent || '',
    };
  });
}

async function clearSel() {
  await page.evaluate(() => window.clearResult());
  await sleep(300);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: 'new',
    args: ['--no-sandbox', '--window-size=1500,950'],
    defaultViewport: { width: 1500, height: 950 },
  });
  page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('#map svg path').length > 100, { timeout: 30000 });
  await sleep(1500);

  // ── Global wiring ─────────────────────────────────────────────────────────
  const wiring = await page.evaluate(() => ({
    updateCostGlobal: typeof window.updateCost === 'function',
    pat73: !!document.querySelector('pattern#subpat-73'),
    pat69: !!document.querySelector('pattern#subpat-69'),
    pat16: !!document.querySelector('pattern#subpat-16'),
    pat76: !!document.querySelector('pattern#subpat-76'),
    striped: {
      l73: Array.from(document.querySelectorAll('#map svg path')).filter(p => (p.getAttribute('fill') || '') === 'url(#subpat-73)').length,
      l69: Array.from(document.querySelectorAll('#map svg path')).filter(p => (p.getAttribute('fill') || '') === 'url(#subpat-69)').length,
      l16: Array.from(document.querySelectorAll('#map svg path')).filter(p => (p.getAttribute('fill') || '') === 'url(#subpat-16)').length,
      l76: Array.from(document.querySelectorAll('#map svg path')).filter(p => (p.getAttribute('fill') || '') === 'url(#subpat-76)').length,
    },
  }));
  check('updateCost exposed to window', wiring.updateCostGlobal);
  check('stripe patterns injected (73/69/16/76)', wiring.pat73 && wiring.pat69 && wiring.pat16 && wiring.pat76);
  check('Local 73: 6 striped counties', wiring.striped.l73 === 6, 'got ' + wiring.striped.l73);
  check('Local 69: 1 striped county (Salt Lake)', wiring.striped.l69 === 1, 'got ' + wiring.striped.l69);
  check('Local 16: 18 striped counties', wiring.striped.l16 === 18, 'got ' + wiring.striped.l16);
  check('Local 76: 1 striped county (Los Alamos)', wiring.striped.l76 === 1, 'got ' + wiring.striped.l76);

  // ── Local 73: Pima County (Southern AZ) ───────────────────────────────────
  await clickLatLng(32.1, -111.5, 8); // rural Pima County
  let r = await readCard();
  check('L73 Pima: county resolved', /Pima County/.test(r.county), r.county);
  check('L73 Pima: Southern AZ banner', /Southern AZ Target Area/.test(r.card));
  check('L73 Pima: dispatching from Tucson', /Dispatching from\s*Tucson/i.test(r.card.replace(/\s+/g, ' ')));
  check('L73 Pima: rate tagged Southern AZ', /Southern AZ ·/.test(r.calc), r.calc.slice(0, 80));
  check('L73 Pima: SAZ zone table listed', /85\+ mi/.test(r.card));
  await clearSel();

  // ── Local 73: Yuma County — preferred dispatch must swap to Tucson ────────
  await clickLatLng(32.8, -113.9, 7); // rural Yuma County
  r = await readCard();
  check('L73 Yuma: county resolved', /Yuma County/.test(r.county), r.county);
  check('L73 Yuma: dispatch forced to Tucson', /Dispatching from\s*Tucson/i.test(r.card.replace(/\s+/g, ' ')));
  check('L73 Yuma: Zone 3 from Tucson mileage note', /from Tucson City Hall/.test(r.calc), r.calc.slice(0, 200));
  await clearSel();

  // ── Local 73: Palo Verde named site (Maricopa — outside SAZ counties) ─────
  await clickLatLng(33.388, -112.862, 10);
  r = await readCard();
  check('L73 Palo Verde: site banner', /Palo Verde/.test(r.card));
  check('L73 Palo Verde: Zone 3 override', /Zone 3[^$]*Palo Verde/.test(r.calc), r.calc.slice(0, 120));
  check('L73 Palo Verde: $95 despite short distance', /\$95\.00/.test(r.calc), r.calc.slice(0, 120));
  // Davis-Bacon toggle halves it
  const dbState = await page.evaluate(() => {
    const el = document.getElementById('calc-db');
    if (!el) return { present: false };
    el.value = '1'; el.dispatchEvent(new Event('change'));
    window.updateCost();
    return { present: true, calc: (document.getElementById('calc-out') || {}).textContent || '' };
  });
  check('L73: Davis-Bacon select present', dbState.present);
  check('L73: Davis-Bacon halves Zone 3 to $47.50', dbState.present && /\$47\.50/.test(dbState.calc), (dbState.calc || '').slice(0, 120));
  await clearSel();

  // ── Local 73: Globe named Zone 2 (would be Zone 3 by distance) ────────────
  await clickLatLng(33.394, -110.786, 10);
  r = await readCard();
  check('L73 Globe: Zone 2 override', /Zone 2[^$]*Globe/.test(r.calc), r.calc.slice(0, 120));
  check('L73 Globe: $40/day', /\$40\.00/.test(r.calc));
  await clearSel();

  // ── Local 69: Salt Lake County = Salt Lake Valley schedule ────────────────
  await clickLatLng(40.65, -111.95, 9); // SL valley floor
  r = await readCard();
  check('L69 SLC: county resolved', /Salt Lake County/.test(r.county), r.county);
  check('L69 SLC: Salt Lake Valley banner', /Salt Lake Valley Zone/.test(r.card));
  check('L69 SLC: Schedule A table in use', /Salt Lake Valley|SL Valley|0–30 mi/.test(r.calc), r.calc.slice(0, 100));
  await clearSel();

  // ── Local 69: outlying county = Schedule B ────────────────────────────────
  await clickLatLng(40.45, -109.5, 8); // Uintah County (~130 road mi)
  r = await readCard();
  check('L69 Uintah: county resolved', /Uintah County/.test(r.county), r.county);
  check('L69 Uintah: Schedule B subsistence + residence note', /residence city hall/i.test(r.calc), r.calc.slice(0, 220));
  check('L69 Uintah: no SLV banner outside Salt Lake County', !/Salt Lake Valley Zone.*interpretive/.test(r.card));
  check('L69: Schedule B table shown (25-mi free zone)', /0–25 mi/.test(r.card));
  await clearSel();

  // ── Local 16: Placer County east/west of Hwy 49 ───────────────────────────
  await clickLatLng(39.17, -120.30, 9); // east side (Tahoe NF area, Placer)
  r = await readCard();
  check('L16 Placer east: county resolved', /Placer County/.test(r.county), r.county);
  check('L16 Placer east: $40 east rate', /\$40\.00/.test(r.calc) && /East of Hwy 49/.test(r.calc), r.calc.slice(0, 160));
  await clearSel();
  await clickLatLng(38.78, -121.25, 10); // west side (Roseville area, Placer)
  r = await readCard();
  check('L16 Placer west: $15 west rate', /\$15\.00/.test(r.calc) && /West of Hwy 49/.test(r.calc), r.calc.slice(0, 160));
  await clearSel();

  // ── Local 16: Monterey = striped subsistence county ───────────────────────
  await clickLatLng(36.3, -121.3, 9);
  r = await readCard();
  check('L16 Monterey: county resolved', /Monterey County/.test(r.county), r.county);
  check('L16 Monterey: subsistence banner', /Subsistence County/.test(r.card));
  check('L16 Monterey: $100 + in/out', /\$100\.00/.test(r.calc) && /\$120\.00/.test(r.calc), r.calc.slice(0, 160));
  await clearSel();

  // ── Local 76: Los Alamos County ───────────────────────────────────────────
  await clickLatLng(35.87, -106.29, 10);
  r = await readCard();
  check('L76 Los Alamos: county resolved', /Los Alamos County/.test(r.county), r.county);
  check('L76 Los Alamos: banner', /Los Alamos County/.test(r.card) && /company vehicle/i.test(r.card));
  check('L76 Los Alamos: $40 flat, no mileage line', /\$40\.00/.test(r.calc) && !/one way, once per project/.test(r.calc), r.calc.slice(0, 160));
  await clearSel();

  // ── Local 28: no phantom Board & Room zone row; hourly-first labels ───────
  await clickLatLng(38.25, -104.6, 8); // Pueblo County
  r = await readCard();
  check('L28 Pueblo: county resolved', /Pueblo County/.test(r.county), r.county);
  check('L28: no "Board & Room Zone" row', !/Board & Room Zone/.test(r.card));
  check('L28: hourly-first Zone 2 label', /\$10\.00\/hr/.test(r.card), '');
  await clearSel();

  // ── Local 135: hourly + waiver notes in result card ───────────────────────
  await clickLatLng(36.9, -114.9, 8); // Clark County north
  r = await readCard();
  check('L135: per-hour note present', /per hour worked/i.test(r.card));
  check('L135: four-city waiver note present', /physical cities/i.test(r.card));
  await clearSel();

  await page.screenshot({ path: 'subareas_verify.png' });
  const failed = results.filter(x => !x.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
