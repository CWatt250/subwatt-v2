// Verify the Rate Zone toggle works when an IREX branch is the dispatch point.
// Scenario (mirrors Issue 1 verify steps):
//   destination = Morrow County OR (41049, Local 36)
//   dispatch    = Irex Pasco branch (sits in Local 82 territory)
//   => toggle [Local 82 | Local 36] appears, default 82 active
//   toggle to 36 (rate moves), back to 82 (rate returns)
//   ALSO: a destination IN the branch's own local must hide the toggle.
const puppeteer = require('puppeteer-core');
const https = require('https');

const EXE = process.env.CHROME || '/usr/bin/chromium-browser';
const BASE = process.argv[2] || 'http://127.0.0.1:8731';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SUPA = 'https://qhrpmpbjeyhgryssnjhg.supabase.co';
const KEY = 'sb_publishable_y9X5a2ueaYYa3Yyc3UyOFQ_vAiNn8DU';
// Fetch the live Irex branch list so we can drive useIrexAsDispatch(id) directly
// (IREX_BRANCHES is a bootApp-scoped var, not exposed on window).
function fetchBranches() {
  return new Promise((resolve, reject) => {
    https.get(SUPA + '/rest/v1/global_config?select=value&key=eq.irex_branches', { headers: { apikey: KEY } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)[0].value); } catch (e) { reject(e); } }); })
      .on('error', reject);
  });
}

function snapshot() {
  const wrap = document.getElementById('rate-toggle');
  const visible = wrap && wrap.style.display !== 'none' && wrap.innerHTML.trim() !== '';
  const btns = wrap ? Array.from(wrap.querySelectorAll('button')) : [];
  const toggle = btns.map(b => ({ label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') === 'true' }));
  const out = document.getElementById('calc-out');
  const m = out ? (out.textContent.match(/\$[\d,]+(?:\.\d+)?/) || [null])[0] : null;
  const rl = (typeof RATE_LID !== 'undefined') ? RATE_LID : null;
  const cl = (typeof CUR_LID !== 'undefined') ? CUR_LID : null;
  const pd = (typeof PRIMARY_DISPATCH !== 'undefined') ? PRIMARY_DISPATCH : null;
  return {
    RATE_LID: rl === null ? 'NULL' : rl,
    CUR_LID: cl,
    dispLid: pd ? pd.lid : null,
    dispName: pd ? pd.name : null,
    toggleVisible: visible, toggle, rate: m,
  };
}

function clickToggle(n) {
  const wrap = document.getElementById('rate-toggle');
  const b = Array.from(wrap.querySelectorAll('button')).find(x => x.textContent.replace(/\s+/g, ' ').includes('Local ' + n));
  if (!b) return 'NO_BUTTON_' + n;
  b.click();
  return 'clicked ' + n;
}

// Click a destination county polygon by FIPS id.
function clickCounty(fips) {
  let t = null;
  window.subwattMap.eachLayer(layer => {
    if (t) return;
    if (layer.feature && String(layer.feature.id) === fips) t = layer;
    if (layer.eachLayer) layer.eachLayer(s => { if (!t && s.feature && String(s.feature.id) === fips) t = s; });
  });
  if (!t) return 'NO_COUNTY_' + fips;
  t.fire('click', { latlng: t.getBounds().getCenter() });
  return 'clicked ' + fips;
}

// Dispatch from an Irex branch by id (window.useIrexAsDispatch is exposed).
function dispatchFromIrexId(id) {
  if (typeof window.useIrexAsDispatch !== 'function') return 'NO_FN';
  window.useIrexAsDispatch(id);
  return 'dispatched from branch id ' + id;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const branches = await fetchBranches();
  const pasco = branches.find(b => /pasco/i.test(b.name || ''));
  if (!pasco) { console.error('No Pasco branch found in Supabase'); process.exit(2); }
  console.log('Pasco branch:', JSON.stringify(pasco));

  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1400, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(BASE + '/?cb=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(
    () => window.subwattMap && window.LOCALS && document.querySelectorAll('.dp-btn').length > 0,
    { timeout: 40000 }
  ).catch(() => {});
  await sleep(1500);

  const r = {};
  // 1) Destination = Morrow County OR (Local 36)
  r.clickDest = await page.evaluate(clickCounty, '41049');
  await sleep(2500);
  r.afterDest = await page.evaluate(snapshot);

  // 2) Dispatch from the Irex Pasco branch (Local 82 territory)
  r.dispatchPasco = await page.evaluate(dispatchFromIrexId, pasco.id);
  await sleep(3500);
  r.afterIrex = await page.evaluate(snapshot);

  // 3) Toggle to destination local (36)
  r.toggle36 = await page.evaluate(clickToggle, 36);
  await sleep(800);
  r.afterToggle36 = await page.evaluate(snapshot);

  // 4) Toggle back to dispatch local (82)
  r.toggle82 = await page.evaluate(clickToggle, 82);
  await sleep(800);
  r.afterToggle82 = await page.evaluate(snapshot);

  // 5) Negative case: destination IN the branch's own local (Benton 53005) hides toggle
  r.clickSameLocal = await page.evaluate(clickCounty, '53005');
  await sleep(2500);
  r.dispatchPasco2 = await page.evaluate(dispatchFromIrexId, pasco.id);
  await sleep(3000);
  r.afterSameLocal = await page.evaluate(snapshot);

  await page.screenshot({ path: '/home/cwatt250/Dev/subwatt-v2/irex_toggle_verify.png' });
  console.log(JSON.stringify({ results: r, errors }, null, 2));

  const activeIs = (s, n) => s.toggleVisible && s.toggle.some(t => t.label.includes('Local ' + n) && t.pressed);
  const hasSeg = (s, n) => s.toggle.some(t => t.label.includes('Local ' + n));
  const eq = (x, n) => String(x) === String(n);
  const checks = [];
  const ok = (name, cond) => checks.push({ name, pass: !!cond });

  ok('Irex Pasco dispatch resolves to Local 82', eq(r.afterIrex.dispLid, 82) && /pasco/i.test(r.afterIrex.dispName || ''));
  ok('toggle visible after Irex dispatch', r.afterIrex.toggleVisible);
  ok('toggle shows both Local 82 and Local 36 segments', hasSeg(r.afterIrex, 82) && hasSeg(r.afterIrex, 36));
  ok('default active = dispatch Local 82', activeIs(r.afterIrex, 82));
  ok('toggle->36: Local 36 active', activeIs(r.afterToggle36, 36) && !activeIs(r.afterToggle36, 82));
  ok('toggle->36: rate changed', r.afterToggle36.rate && r.afterToggle36.rate !== r.afterIrex.rate);
  ok('toggle->82: Local 82 active again', activeIs(r.afterToggle82, 82) && !activeIs(r.afterToggle82, 36));
  ok('toggle->82: rate returns to dispatch value', r.afterToggle82.rate === r.afterIrex.rate);
  ok('destination in branch local: toggle hidden', !r.afterSameLocal.toggleVisible);
  ok('no page errors', errors.length === 0);

  console.log('\n=== CHECKS ===');
  checks.forEach(c => console.log((c.pass ? 'PASS' : 'FAIL') + '  ' + c.name));
  const allPass = checks.every(c => c.pass);
  console.log('\nRESULT: ' + (allPass ? 'ALL PASS' : 'FAILURES PRESENT'));
  await browser.close();
  process.exit(allPass ? 0 : 1);
})().catch(err => { console.error(err); process.exit(2); });
