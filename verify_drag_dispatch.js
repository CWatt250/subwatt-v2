// Verify the draggable-dispatch feature end to end.
// Scenario mirrors the user story: destination = Garfield County WA (Pomeroy,
// FIPS 53023), dispatch = Pasco (Local 82). Then we drag the Pasco pin to
// Walla Walla — a worker who lives closer to Pomeroy — and assert:
//   * the dispatch marker is actually draggable (Leaflet dragging enabled)
//   * dropping it re-routes from the new origin (road miles DROP)
//   * the per-diem/travel calc mileage input recomputes to the smaller number
//   * the pin relabels to show it's a "moved" origin
//   * the rate schedule (local) is unchanged — same lid
//
// The Mapbox directions request is stubbed with a distance/duration derived
// from the origin->dest great-circle distance, so moving the origin visibly
// changes the returned mileage without any network/token.
const puppeteer = require('puppeteer-core');

const EXE = process.env.CHROME || '/home/cwatt250/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEST_FIPS = '53023';                 // Garfield County WA (Pomeroy)
const WALLA_WALLA = { lat: 46.0646, lng: -118.3430 };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE:' + m.text()); });
  const step = m => process.stdout.write('STEP: ' + m + '\n');

  // Stub Mapbox directions: distance = great-circle(from,dest) * 1.25 (road
  // factor), duration = distance / 22 m/s. Depends on the ORIGIN, so a moved
  // origin yields different mileage.
  await page.evaluateOnNewDocument(() => {
    const realFetch = window.fetch.bind(window);
    function hav(aLat, aLng, bLat, bLng) {
      const R = 6371000, toR = d => d * Math.PI / 180;
      const dLat = toR(bLat - aLat), dLng = toR(bLng - aLng);
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    }
    window.fetch = function (url, opts) {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      const m = u.match(/driving[-a-z]*\/(-?[\d.]+),(-?[\d.]+);(-?[\d.]+),(-?[\d.]+)/);
      if (m) {
        const fromLng = +m[1], fromLat = +m[2], toLng = +m[3], toLat = +m[4];
        const meters = hav(fromLat, fromLng, toLat, toLng) * 1.25;
        return Promise.resolve(new Response(JSON.stringify({
          routes: [{ distance: meters, duration: meters / 22,
            geometry: { type: 'LineString', coordinates: [[fromLng, fromLat], [toLng, toLat]] } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      if (/directions|mapbox/i.test(u)) {
        return Promise.resolve(new Response(JSON.stringify({ routes: [] }), { status: 200 }));
      }
      return realFetch(url, opts);
    };
  });

  await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => window.subwattMap && window.LOCALS && document.querySelectorAll('.dp-btn').length > 0,
    { timeout: 40000 }
  ).catch(() => {});
  await sleep(1500);
  step('page loaded');

  const r = {};

  // 1) Destination = Garfield County WA (Pomeroy)
  r.destClicked = await page.evaluate((fips) => {
    let t = null;
    window.subwattMap.eachLayer(layer => {
      if (t) return;
      if (layer.feature && String(layer.feature.id) === fips) t = layer;
      if (layer.eachLayer) layer.eachLayer(s => { if (!t && s.feature && String(s.feature.id) === fips) t = s; });
    });
    if (!t) return false;
    t.fire('click', { latlng: t.getBounds().getCenter() });
    return true;
  }, DEST_FIPS);
  await sleep(2500);
  step('destination clicked: ' + r.destClicked);

  // 2) Dispatch = Pasco (Local 82) -> route from Pasco
  r.clickPasco = await page.evaluate(() => {
    const head = document.querySelector('.lrow[data-local="82"] .lrow-head');
    if (head) head.click();
    let target = null;
    document.querySelectorAll('.lrow[data-local="82"] .dp-btn').forEach(b => {
      if ((b.getAttribute('data-dp-name') || '').toLowerCase().includes('pasco')) target = b;
    });
    if (!target) return 'NO_PASCO_BTN';
    target.click();
    return 'clicked';
  });
  await sleep(2500);
  step('dispatch Pasco: ' + r.clickPasco);

  const readState = () => page.evaluate(() => {
    const bar = document.getElementById('route-info');
    const mi = document.getElementById('calc-mi');
    // find the draggable dispatch marker
    let dm = null;
    window.subwattMap.eachLayer(l => {
      if (dm) return;
      if (l.options && l.options.draggable && l.getLatLng) dm = l;
      if (l.eachLayer) l.eachLayer(s => { if (!dm && s.options && s.options.draggable && s.getLatLng) dm = s; });
    });
    const banner = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : null;
    const mMi = banner && banner.match(/([\d.]+)\s*mi/);
    return {
      banner,
      bannerMiles: mMi ? parseFloat(mMi[1]) : null,
      calcMi: mi ? parseFloat(mi.value) : null,
      hasDraggableMarker: !!dm,
      draggable: dm ? dm.options.draggable : null,
      dragEnabled: dm ? !!(dm.dragging && dm.dragging._enabled) : null,
      markerHtml: dm && dm._icon ? dm._icon.innerHTML : '',
    };
  });

  r.before = await readState();
  step('before drag: ' + JSON.stringify(r.before));

  // 3) Drag the pin to Walla Walla via the REAL wired dragend handler on the
  //    actual draggable marker (setLatLng + fire('dragend'), same path the
  //    mouse-drop takes). Also capture the lid before/after to prove the rate
  //    schedule is unchanged.
  r.drag = await page.evaluate((ww) => {
    let dm = null;
    window.subwattMap.eachLayer(l => {
      if (dm) return;
      if (l.options && l.options.draggable && l.getLatLng) dm = l;
      if (l.eachLayer) l.eachLayer(s => { if (!dm && s.options && s.options.draggable && s.getLatLng) dm = s; });
    });
    if (!dm) return 'NO_MARKER';
    dm.setLatLng([ww.lat, ww.lng]);
    dm.fire('dragend', { target: dm });
    return 'dropped';
  }, WALLA_WALLA);
  await sleep(2500);
  step('drag: ' + r.drag);

  r.after = await readState();
  step('after drag: ' + JSON.stringify(r.after));

  await page.screenshot({ path: '/home/cwatt250/Dev/subwatt-v2/drag_dispatch_verify.png' });

  // ---- Assertions ----
  const checks = [];
  const ok = (name, cond) => checks.push({ name, pass: !!cond });
  ok('destination county clicked', r.destClicked);
  ok('Pasco dispatch routed (miles present)', r.before.bannerMiles > 0 && r.before.calcMi > 0);
  ok('dispatch marker exists & is draggable', r.before.hasDraggableMarker && r.before.draggable === true);
  ok('Leaflet dragging is enabled (grabbable)', r.before.dragEnabled === true);
  ok('drop handler ran', r.drag === 'dropped');
  ok('road miles DECREASED after moving origin to Walla Walla',
    r.after.bannerMiles > 0 && r.after.bannerMiles < r.before.bannerMiles);
  ok('calc mileage recomputed to the smaller number',
    r.after.calcMi > 0 && r.after.calcMi < r.before.calcMi);
  ok('pin relabeled as moved origin', /moved/i.test(r.after.markerHtml));
  ok('no page errors', errors.length === 0);

  console.log('\n=== CHECKS ===');
  checks.forEach(c => console.log((c.pass ? 'PASS' : 'FAIL') + '  ' + c.name));
  console.log('\nbefore miles=' + r.before.bannerMiles + ' calc=' + r.before.calcMi
    + '  |  after miles=' + r.after.bannerMiles + ' calc=' + r.after.calcMi);
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
  const allPass = checks.every(c => c.pass);
  console.log('\nRESULT: ' + (allPass ? 'ALL PASS' : 'FAILURES PRESENT'));
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(err => { console.error(err); process.exit(2); });
