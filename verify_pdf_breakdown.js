// Verify the sidebar rate-math breakdown appears under DAILY TRAVEL RATE in the
// exported PDF, for both calc kinds:
//   A) Mileage zone (Local 7): dest King Co WA (53033), dispatch Seattle,
//      canned 23 mi -> sidebar shows "$0.67 × 3 mi × 2 (round-trip from free zone edge)"
//      -> PDF must contain the SAME text, drawn after the DAILY TRAVEL RATE label.
//   B) Travel zone (Local 82): dest Morrow Co OR (41049), dispatch Pasco,
//      canned 143.7 mi -> Zone 6+ Subsistence, note "Includes $35/day meals"
//      -> PDF must contain the same note.
// The Mapbox directions request is stubbed so miles are deterministic; jsPDF.text()
// is wrapped to capture every string drawn into the PDF (same rig as
// verify_pdf_drivetime.js).
const puppeteer = require('puppeteer-core');

const EXE = process.env.CHROME || '/usr/bin/chromium-browser';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SCENARIOS = [
  {
    name: 'Local 7 mileage zone',
    fips: '53033', localRow: '7', dispatchMatch: 'seattle',
    cannedDistM: 37015, cannedDurS: 1800,            // 23.0 mi
    expectNoteRe: /^\$0\.67 × 3 mi × 2 \(round-trip from free zone edge\)$/,
  },
  {
    name: 'Local 82 travel zone',
    fips: '41049', localRow: '82', dispatchMatch: 'pasco',
    cannedDistM: 231262, cannedDurS: 10980,          // 143.7 mi -> Zone 6+
    expectNoteRe: /Includes \$35\/day meals/,
  },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    protocolTimeout: 180000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const checks = [];
  const ok = (name, cond) => { checks.push({ name, pass: !!cond }); console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); };

  for (const sc of SCENARIOS) {
    console.log('\n=== SCENARIO: ' + sc.name + ' ===');
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setViewport({ width: 1400, height: 900 });
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('dialog', async d => { errors.push('DIALOG: ' + d.message()); try { await d.dismiss(); } catch (e) {} });

    await page.evaluateOnNewDocument((dist, dur) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = function (url, opts) {
        const u = typeof url === 'string' ? url : (url && url.url) || '';
        if (/directions|route\/v1|mapbox/i.test(u)) {
          return Promise.resolve(new Response(JSON.stringify({
            routes: [{ distance: dist, duration: dur, geometry: { type: 'LineString', coordinates: [[-120, 46.5], [-121, 47]] } }]
          }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return realFetch(url, opts);
      };
    }, sc.cannedDistM, sc.cannedDurS);

    await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction(
      () => window.subwattMap && window.LOCALS && document.querySelectorAll('.dp-btn').length > 0,
      { timeout: 40000 }
    ).catch(() => {});
    await sleep(1500);

    // Click destination county, then the dispatch button
    await page.evaluate((fips) => {
      let t = null;
      window.subwattMap.eachLayer(layer => {
        if (t) return;
        if (layer.feature && String(layer.feature.id) === fips) t = layer;
        if (layer.eachLayer) layer.eachLayer(s => { if (!t && s.feature && String(s.feature.id) === fips) t = s; });
      });
      if (t) t.fire('click', { latlng: t.getBounds().getCenter() });
    }, sc.fips);
    await sleep(2500);

    const clickRes = await page.evaluate((row, match) => {
      const head = document.querySelector('.lrow[data-local="' + row + '"] .lrow-head');
      if (head) head.click();
      const btns = document.querySelectorAll('.lrow[data-local="' + row + '"] .dp-btn');
      let target = null;
      btns.forEach(b => { if ((b.getAttribute('data-dp-name') || '').toLowerCase().includes(match)) target = b; });
      if (!target) return 'NO_DISPATCH_' + match;
      target.click();
      return 'clicked ' + match;
    }, sc.localRow, sc.dispatchMatch);
    await sleep(2500);
    console.log('dispatch: ' + clickRes);

    // Read the sidebar breakdown exactly as exportPdf scrapes it
    const sidebar = await page.evaluate(() => {
      const out = document.getElementById('calc-out');
      if (!out) return { zone: null, rate: null, note: null };
      const zEl = out.querySelector('div[style*="text-transform:uppercase"]');
      const rEl = out.querySelector('div[style*="Space Mono"]');
      let note = null;
      if (rEl && rEl.nextElementSibling) note = rEl.nextElementSibling.textContent.trim();
      return { zone: zEl ? zEl.textContent : null, rate: rEl ? rEl.textContent.trim() : null, note };
    });
    console.log('sidebar: ' + JSON.stringify(sidebar));

    // Wrap jsPDF, stub raster capture, run the REAL exportPdf
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
      const mkCanvas = (node) => {
        const w = (node && node.offsetWidth) || 240, h = (node && node.offsetHeight) || 140;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.fillStyle = '#e2e8f0'; x.fillRect(0, 0, w, h);
        return c;
      };
      if (typeof window.domtoimage !== 'undefined') window.domtoimage.toPng = function (node) { return Promise.resolve(mkCanvas(node).toDataURL('image/png')); };
      window.html2canvas = function (node) { return Promise.resolve(mkCanvas(node)); };
    });
    await page.evaluate(() => window.exportPdf());
    await sleep(5000);

    const pdf = await page.evaluate(() => ({ saved: window.__pdfSaved, text: window.__pdfText }));
    console.log('pdf strings: ' + pdf.text.length);

    const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
    const rateIdx = pdf.text.findIndex(t => norm(t) === 'DAILY TRAVEL RATE');
    const noteIdx = sidebar.note ? pdf.text.findIndex(t => norm(t) === norm(sidebar.note)) : -1;

    ok(sc.name + ': sidebar note matches expected format', sidebar.note && sc.expectNoteRe.test(norm(sidebar.note)));
    ok(sc.name + ': PDF generated (save called)', pdf.saved);
    ok(sc.name + ': PDF has DAILY TRAVEL RATE row', rateIdx !== -1);
    ok(sc.name + ': PDF contains the sidebar breakdown verbatim', noteIdx !== -1);
    ok(sc.name + ': breakdown drawn after the rate label', noteIdx > rateIdx);
    ok(sc.name + ': no page errors', errors.length === 0);
    if (errors.length) console.log('errors: ' + JSON.stringify(errors));
    console.log('PDF tail: ' + JSON.stringify(pdf.text.slice(Math.max(0, rateIdx - 1))));
    await page.close();
  }

  const allPass = checks.every(c => c.pass);
  console.log('\nRESULT: ' + (allPass ? 'ALL PASS' : 'FAILURES PRESENT'));
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(err => { console.error(err); process.exit(2); });
