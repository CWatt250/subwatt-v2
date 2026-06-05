// Verify the Rate Zone toggle no longer gets stuck after a dispatch switch.
// Scenario (mirrors the goal's verify steps):
//   destination = Morrow County OR (Boardman, Local 36)
//   dispatch    = Pasco (Local 82) -> toggle [Local 82 | Local 36], default 82
//   toggle to Local 36 (rate updates), back to Local 82 (rate updates)
//   switch dispatch to Spokane (Local 82) -> toggle MUST reset to 82 active,
//   and BOTH toggle directions must work again.
const puppeteer = require('puppeteer-core');

const EXE = process.env.CHROME || '/usr/bin/chromium-browser';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Read the live toggle + rate state out of the page.
function snapshot() {
  const wrap = document.getElementById('rate-toggle');
  const visible = wrap && wrap.style.display !== 'none' && wrap.innerHTML.trim() !== '';
  const btns = wrap ? Array.from(wrap.querySelectorAll('button')) : [];
  const toggle = btns.map(b => ({
    label: b.textContent.trim(),
    pressed: b.getAttribute('aria-pressed') === 'true',
  }));
  const out = document.getElementById('calc-out');
  const m = out ? (out.textContent.match(/\$[\d,]+(?:\.\d+)?/) || [null])[0] : null;
  // Read app globals by bare name (they're page-global vars, not all mirrored
  // onto window). null-coalesce so JSON keeps the key even when the value is null.
  const rl = (typeof RATE_LID !== 'undefined') ? RATE_LID : null;
  const cl = (typeof CUR_LID !== 'undefined') ? CUR_LID : null;
  const pd = (typeof PRIMARY_DISPATCH !== 'undefined') ? PRIMARY_DISPATCH : null;
  return {
    RATE_LID: rl === null ? 'NULL' : rl,
    CUR_LID: cl,
    dispLid: pd ? pd.lid : null,
    dispName: pd ? pd.name : null,
    toggleVisible: visible,
    toggle,
    rate: m,
  };
}

// Click a top-bar toggle button whose text contains "Local <n>".
function clickToggle(n) {
  const wrap = document.getElementById('rate-toggle');
  const b = Array.from(wrap.querySelectorAll('button'))
    .find(x => x.textContent.replace(/\s+/g, ' ').includes('Local ' + n));
  if (!b) return 'NO_BUTTON_' + n;
  b.click();
  return 'clicked ' + n;
}

// Expand a local's sidebar row and click one of its dispatch buttons by name.
function clickDispatch(localId, nameFrag) {
  const head = document.querySelector('.lrow[data-local="' + localId + '"] .lrow-head');
  if (head) head.click();
  const btns = document.querySelectorAll('.lrow[data-local="' + localId + '"] .dp-btn');
  let target = null;
  btns.forEach(b => {
    if ((b.getAttribute('data-dp-name') || '').toLowerCase().includes(nameFrag.toLowerCase())) target = b;
  });
  if (!target) return 'NO_DISPATCH_' + nameFrag;
  target.click();
  return 'clicked ' + nameFrag;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  // Wait for data + map to be ready (LOCALS loaded, dispatch buttons rendered).
  await page.waitForFunction(
    () => window.subwattMap && window.LOCALS && document.querySelectorAll('.dp-btn').length > 0,
    { timeout: 40000 }
  ).catch(() => {});
  await sleep(1500);

  const results = {};

  // 1) Destination = Morrow County OR (Boardman) -> Local 36
  await page.evaluate(() => {
    let t = null;
    window.subwattMap.eachLayer(layer => {
      if (t) return;
      if (layer.feature && String(layer.feature.id) === '41049') t = layer;
      if (layer.eachLayer) layer.eachLayer(s => { if (!t && s.feature && String(s.feature.id) === '41049') t = s; });
    });
    if (t) t.fire('click', { latlng: t.getBounds().getCenter() });
  });
  await sleep(3000);
  results.afterDestination = await page.evaluate(snapshot);

  // 2) Select Pasco dispatch (Local 82)
  results.clickPasco = await page.evaluate(clickDispatch, 82, 'pasco');
  await sleep(3500);
  results.afterPasco = await page.evaluate(snapshot);

  // 3) Toggle to Local 36 (destination local)
  results.toggle36 = await page.evaluate(clickToggle, 36);
  await sleep(800);
  results.afterToggle36 = await page.evaluate(snapshot);

  // 4) Toggle back to Local 82 (dispatch local)
  results.toggle82 = await page.evaluate(clickToggle, 82);
  await sleep(800);
  results.afterToggle82 = await page.evaluate(snapshot);

  // 5) Switch dispatch to Spokane (Local 82) -> toggle must reset to 82 active
  results.clickSpokane = await page.evaluate(clickDispatch, 82, 'spokane');
  await sleep(3500);
  results.afterSpokane = await page.evaluate(snapshot);

  // 6) Confirm BOTH directions work again after the switch
  results.reToggle36 = await page.evaluate(clickToggle, 36);
  await sleep(800);
  results.afterReToggle36 = await page.evaluate(snapshot);
  results.reToggle82 = await page.evaluate(clickToggle, 82);
  await sleep(800);
  results.afterReToggle82 = await page.evaluate(snapshot);

  await page.screenshot({ path: '/home/cwatt250/Dev/subwatt-v2/rate_toggle_verify.png' });

  console.log(JSON.stringify({ results, errors }, null, 2));

  // ---- Assertions ----
  // Assert purely on OBSERVABLE behaviour: which toggle segment is pressed
  // (aria-pressed, driven by the effective rate local) and the recalculated $.
  const a = results;
  const activeIs = (snap, n) => snap.toggleVisible && snap.toggle.some(t => t.label.includes('Local ' + n) && t.pressed);
  const hasSeg = (snap, n) => snap.toggle.some(t => t.label.includes('Local ' + n));
  const eq = (x, n) => String(x) === String(n);
  const checks = [];
  const ok = (name, cond) => { checks.push({ name, pass: !!cond }); };

  ok('destination shows Local 36 segment', hasSeg(a.afterPasco, 36));
  ok('Pasco dispatch is Local 82', eq(a.afterPasco.dispLid, 82) && /pasco/i.test(a.afterPasco.dispName || ''));
  ok('toggle visible after Pasco', a.afterPasco.toggleVisible);
  ok('default active = Local 82 after Pasco', activeIs(a.afterPasco, 82));
  ok('toggle->36: Local 36 active', activeIs(a.afterToggle36, 36) && !activeIs(a.afterToggle36, 82));
  ok('toggle->36: rate changed', a.afterToggle36.rate && a.afterToggle36.rate !== a.afterPasco.rate);
  ok('toggle->82: Local 82 active', activeIs(a.afterToggle82, 82) && !activeIs(a.afterToggle82, 36));
  ok('toggle->82: rate returns to dispatch-local value', a.afterToggle82.rate === a.afterPasco.rate);
  // The core fix: switching dispatch resets the toggle to the dispatch local.
  ok('Spokane dispatch is Local 82', eq(a.afterSpokane.dispLid, 82) && /spokane/i.test(a.afterSpokane.dispName || ''));
  ok('toggle resets to Local 82 active after Spokane', activeIs(a.afterSpokane, 82) && !activeIs(a.afterSpokane, 36));
  // Both directions still work after the switch (the original bug: stuck).
  ok('post-switch toggle->36 works (active + rate moves)', activeIs(a.afterReToggle36, 36) && a.afterReToggle36.rate !== a.afterSpokane.rate);
  ok('post-switch toggle->82 works (active + rate moves back)', activeIs(a.afterReToggle82, 82) && a.afterReToggle82.rate === a.afterSpokane.rate && a.afterReToggle82.rate !== a.afterReToggle36.rate);
  ok('no page errors', errors.length === 0);

  console.log('\n=== CHECKS ===');
  checks.forEach(c => console.log((c.pass ? 'PASS' : 'FAIL') + '  ' + c.name));
  const allPass = checks.every(c => c.pass);
  console.log('\nRESULT: ' + (allPass ? 'ALL PASS' : 'FAILURES PRESENT'));

  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(err => { console.error(err); process.exit(2); });
