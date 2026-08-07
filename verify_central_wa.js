// Verify the Local 7 Central WA sub-territory rendering + pay routing.
// App globals live inside bootApp's closure, so everything here goes through
// the DOM exactly like a real user: read SVG fills, mouse-click a county.
//   1. Map: exactly 5 county paths fill with url(#l7central) stripes; the
//      west-side Local 7 counties keep the solid green fill.
//   2. Clicking a striped county -> result card shows the "Local 7 — Central
//      WA" banner, the renamed zone table, and no "Appendix" text anywhere.
//   3. Calculator routes to the Central WA stepped zones: calc label reads
//      "Zone N" (c7a naming) and the dispatch card is tagged "Central WA".
const puppeteer = require('puppeteer-core');

const EXE = process.env.CHROME || '/usr/bin/chromium-browser';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1500,950'],
    defaultViewport: { width: 1500, height: 950 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll('#map svg path').length > 100, { timeout: 30000 });
  await sleep(1500);

  // ── 1. Map fill audit ─────────────────────────────────────────────────────
  const fills = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll('#map svg path'));
    const striped = paths.filter(p => (p.getAttribute('fill') || '').includes('l7central'));
    const green = paths.filter(p => (p.getAttribute('fill') || '').toLowerCase() === '#3dd68c');
    return {
      patternInDom: !!document.querySelector('pattern#l7central'),
      stripedCount: striped.length,
      solidGreenCount: green.length,
    };
  });
  console.log('map fills:', JSON.stringify(fills));

  // ── 2. Click a striped county with the real mouse ─────────────────────────
  // Try each striped path's bbox center until the result card opens (a bbox
  // center can fall outside a concave polygon, so probe several points).
  const clicked = await (async () => {
    const boxes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#map svg path'))
        .filter(p => (p.getAttribute('fill') || '').includes('l7central'))
        .map(p => { const r = p.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    });
    for (const b of boxes) {
      await page.mouse.click(b.x, b.y);
      await sleep(1200);
      const open = await page.evaluate(() => {
        const rc = document.getElementById('rc');
        return !!rc && rc.style.display !== 'none' && /Local 7/.test(rc.textContent);
      });
      if (open) return true;
    }
    return false;
  })();
  console.log('clicked striped county, result card open:', clicked);
  await sleep(2500); // route fetch + calculator render

  // The auto-selected dispatch may belong to another local (e.g. Pasco /
  // Local 82); flip the rate toggle to Local 7 so the calc exercises the
  // Central WA zone routing.
  const toggled = await page.evaluate(() => {
    const wrap = document.getElementById('rate-toggle');
    if (!wrap) return 'no-toggle';
    const b = Array.from(wrap.querySelectorAll('button'))
      .find(x => /Local 7\b/.test(x.textContent.replace(/\s+/g, ' ')));
    if (!b) return 'no-local7-button';
    b.click();
    return 'toggled';
  });
  console.log('rate toggle:', toggled);
  await sleep(1200);

  const card = await page.evaluate(() => {
    const rc = document.getElementById('rc');
    const txt = rc ? rc.textContent : '';
    const out = document.getElementById('calc-out');
    const calcTxt = out ? out.textContent : '';
    return {
      hasCentralBanner: /Local 7 — Central WA/.test(txt),
      hasAppendixText: /Appendix/i.test(txt + calcTxt),
      zoneTableHeading: /Central WA — Chelan, Douglas, Kittitas, Okanogan & Yakima/.test(txt),
      calcTaggedCentral: /Central WA/.test(calcTxt),
      calcZoneLabel: (calcTxt.match(/Zone \d[^$]{0,20}/) || [null])[0],
      calcAmount: (calcTxt.match(/\$[\d,]+(\.\d+)?/) || [null])[0],
      county: (document.getElementById('sbm') || {}).textContent || '',
    };
  });
  console.log('result card:', JSON.stringify(card, null, 1));

  // Sidebar legend line under Local 7
  const legend = await page.evaluate(() => {
    const row = document.querySelector('.lrow[data-local="7"]');
    return row ? /Striped area: Central WA/.test(row.textContent) : false;
  });
  console.log('sidebar legend present:', legend);

  await page.screenshot({ path: 'central_wa_verify.png' });

  const pass =
    fills.patternInDom && fills.stripedCount === 5 && fills.solidGreenCount >= 15 &&
    clicked && card.hasCentralBanner && !card.hasAppendixText &&
    card.zoneTableHeading && card.calcTaggedCentral && legend;
  console.log(pass ? 'PASS' : 'FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
