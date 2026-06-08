// Verify drive time appears next to road miles in the exported PDF.
// Scenario (mirrors the goal's verify steps):
//   destination = Morrow County OR (41049), dispatch = Pasco (Local 82)
//   -> a real route completes, the banner shows "<mi> mi · <h>h <m>m drive"
//   -> Export PDF: the "Road miles" row must read "<mi> mi · <h>h <m>m drive"
//
// The Mapbox directions request is stubbed with a canned distance/duration so
// the test is deterministic and needs no network/token. jsPDF.text() is wrapped
// to capture every string drawn into the PDF, so we assert on the REAL output.
const puppeteer = require('puppeteer-core');

const EXE = process.env.CHROME || '/usr/bin/chromium-browser';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Canned route: 143.7 mi, 3h 3m (10980 s). 143.7 mi = 231262 m.
const CANNED_DIST = 231262;     // meters
const CANNED_DUR = 10980;       // seconds -> 183 min -> "3h 3m"
const EXPECT_MILES = Math.round(143.7);          // 144 (LAST_ROUTE_MILES rounds)
const EXPECT_TIME = '3h 3m';

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
  const dialogs = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('CONSOLE:' + m.type() + ': ' + m.text()); });
  page.on('dialog', async d => { dialogs.push(d.message()); try { await d.dismiss(); } catch (e) {} });
  const step = m => { process.stdout.write('STEP: ' + m + '\n'); };

  // Stub the Mapbox directions response before any app code runs.
  await page.evaluateOnNewDocument((dist, dur) => {
    const realFetch = window.fetch.bind(window);
    window.fetch = function (url, opts) {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      if (/directions|route\/v1|mapbox/i.test(u)) {
        return Promise.resolve(new Response(JSON.stringify({
          routes: [{ distance: dist, duration: dur, geometry: { type: 'LineString', coordinates: [[-119, 45.8], [-119.3, 45.9]] } }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, opts);
    };
  }, CANNED_DIST, CANNED_DUR);

  await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => window.subwattMap && window.LOCALS && document.querySelectorAll('.dp-btn').length > 0,
    { timeout: 40000 }
  ).catch(() => {});
  await sleep(1500);
  step('page loaded');

  const results = {};

  // 1) Destination = Morrow County OR (41049)
  await page.evaluate(() => {
    let t = null;
    window.subwattMap.eachLayer(layer => {
      if (t) return;
      if (layer.feature && String(layer.feature.id) === '41049') t = layer;
      if (layer.eachLayer) layer.eachLayer(s => { if (!t && s.feature && String(s.feature.id) === '41049') t = s; });
    });
    if (t) t.fire('click', { latlng: t.getBounds().getCenter() });
  });
  await sleep(2500);
  step('county clicked');

  // 2) Dispatch = Pasco (Local 82) -> triggers the (stubbed) route fetch
  results.clickPasco = await page.evaluate(() => {
    const head = document.querySelector('.lrow[data-local="82"] .lrow-head');
    if (head) head.click();
    const btns = document.querySelectorAll('.lrow[data-local="82"] .dp-btn');
    let target = null;
    btns.forEach(b => { if ((b.getAttribute('data-dp-name') || '').toLowerCase().includes('pasco')) target = b; });
    if (!target) return 'NO_DISPATCH_pasco';
    target.click();
    return 'clicked pasco';
  });
  await sleep(2500);
  step('dispatch clicked: ' + results.clickPasco);

  // 3) Read the banner + globals the PDF relies on
  results.afterRoute = await page.evaluate(() => {
    const bar = document.getElementById('route-info');
    const mi = document.getElementById('calc-mi');
    return {
      bannerText: bar ? bar.textContent.replace(/\s+/g, ' ').trim() : null,
      LAST_ROUTE_MILES: (typeof LAST_ROUTE_MILES !== 'undefined') ? LAST_ROUTE_MILES : null,
      LAST_ROUTE_TIME: (typeof LAST_ROUTE_TIME !== 'undefined') ? LAST_ROUTE_TIME : null,
      calcMi: mi ? mi.value : null,
    };
  });
  step('route read: ' + JSON.stringify(results.afterRoute));

  // 4) Wrap jsPDF.text() + stub save/capture, then run the REAL exportPdf
  await page.evaluate(() => {
    window.__pdfText = [];
    window.__pdfSaved = false;
    const Real = window.jspdf.jsPDF;
    function Wrapped() {
      const inst = new (Function.prototype.bind.apply(Real, [null].concat([].slice.call(arguments))))();
      const origText = inst.text.bind(inst);
      inst.text = function (t) { window.__pdfText.push(Array.isArray(t) ? t.join(' ') : String(t)); return origText.apply(inst, arguments); };
      inst.save = function () { window.__pdfSaved = true; };
      return inst;
    }
    window.jspdf.jsPDF = Wrapped;
    // Stub the heavy raster capture with REAL canvas-generated PNGs (jsPDF's
    // addImage rejects malformed PNGs) so export resolves fast & offline.
    const mkCanvas = (node) => {
      const w = (node && node.offsetWidth) || 240, h = (node && node.offsetHeight) || 140;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#e2e8f0'; x.fillRect(0, 0, w, h);
      return c;
    };
    if (typeof window.domtoimage !== 'undefined') window.domtoimage.toPng = function (node) { return Promise.resolve(mkCanvas(node).toDataURL('image/png')); };
    window.html2canvas = function (node) { return Promise.resolve(mkCanvas(node)); };
  });

  step('jsPDF wrapped, calling exportPdf');
  await page.evaluate(() => window.exportPdf());
  await sleep(5000);
  step('export done; dialogs=' + JSON.stringify(dialogs));

  results.pdf = await page.evaluate(() => ({ saved: window.__pdfSaved, text: window.__pdfText }));
  step('pdf text captured (' + results.pdf.text.length + ' strings)');

  await page.screenshot({ path: '/home/cwatt250/Dev/subwatt-v2/pdf_drivetime_verify.png' });
  console.log(JSON.stringify({ results, errors }, null, 2));

  // ---- Assertions ----
  const a = results;
  const checks = [];
  const ok = (name, cond) => checks.push({ name, pass: !!cond });
  const pdfText = (a.pdf && a.pdf.text) || [];
  const expectRow = EXPECT_MILES + ' mi · ' + EXPECT_TIME + ' drive';
  const rowMatch = pdfText.find(t => t.indexOf(expectRow) !== -1);

  // LAST_ROUTE_TIME lives in bootApp's closure (no window getter), so it can't be
  // read externally — the banner text below is the observable proof of its value,
  // and exportPdf reads it from that same closure.
  ok('route completed (calc-mi populated)', String(a.afterRoute.calcMi) === String(EXPECT_MILES));
  ok('banner shows drive time', a.afterRoute.bannerText && a.afterRoute.bannerText.includes(EXPECT_TIME + ' drive'));
  ok('banner shows miles', a.afterRoute.bannerText && /143\.7 mi/.test(a.afterRoute.bannerText));
  ok('PDF was generated (save called)', a.pdf.saved);
  ok('PDF "Road miles" row has miles + drive time: "' + expectRow + '"', !!rowMatch);
  ok('no page errors', errors.length === 0);

  console.log('\n=== CHECKS ===');
  checks.forEach(c => console.log((c.pass ? 'PASS' : 'FAIL') + '  ' + c.name));
  const allPass = checks.every(c => c.pass);
  console.log('\nMatched PDF row text: ' + (rowMatch || '(none)'));
  console.log('RESULT: ' + (allPass ? 'ALL PASS' : 'FAILURES PRESENT'));

  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(err => { console.error(err); process.exit(2); });
