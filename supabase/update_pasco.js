// Update the Pasco dispatch point for Local 82 to match the Irex Argus Pasco
// branch address: 702 N California Avenue, Pasco, WA 99301.
// Geocoded via Mapbox -> lat 46.240021, lng -119.080706.
//
// Updates BOTH:
//   (1) locals.rate_config.dispatches  — what the live app actually reads
//   (2) dispatch_points table          — the normalized table (kept in sync)
//
// Usage: node supabase/update_pasco.js <SUPABASE_URL> <SERVICE_ROLE_KEY>
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.argv[2];
const SVC_KEY      = process.argv[3];
if (!SUPABASE_URL || !SVC_KEY) {
  console.error('Usage: node supabase/update_pasco.js <SUPABASE_URL> <SERVICE_ROLE_KEY>');
  process.exit(1);
}

const PASCO_NAME = 'Pasco, WA';
const NEW_LAT = 46.240021;
const NEW_LNG = -119.080706;
const LOCAL_ID = '82';

(async () => {
  const supabase = createClient(SUPABASE_URL, SVC_KEY);

  // (1) locals.rate_config.dispatches — the source the app loads.
  const { data: loc, error: readErr } = await supabase
    .from('locals').select('rate_config').eq('id', LOCAL_ID).single();
  if (readErr) throw readErr;

  const rc = loc.rate_config || {};
  const dispatches = Array.isArray(rc.dispatches) ? rc.dispatches : [];
  const idx = dispatches.findIndex(d => d && d.name === PASCO_NAME);
  if (idx === -1) throw new Error(`Pasco dispatch not found in local ${LOCAL_ID} rate_config`);
  console.log('old rate_config Pasco:', JSON.stringify(dispatches[idx]));
  dispatches[idx] = { ...dispatches[idx], lat: NEW_LAT, lng: NEW_LNG };
  rc.dispatches = dispatches;

  const { error: updErr } = await supabase
    .from('locals').update({ rate_config: rc, updated_at: new Date().toISOString() })
    .eq('id', LOCAL_ID);
  if (updErr) throw updErr;
  console.log('new rate_config Pasco:', JSON.stringify(dispatches[idx]));

  // (2) dispatch_points table — keep the normalized table in sync.
  const { data: dp, error: dpReadErr } = await supabase
    .from('dispatch_points').select('id,lat,lng').eq('local_id', LOCAL_ID).eq('name', PASCO_NAME);
  if (dpReadErr) throw dpReadErr;

  if (dp && dp.length) {
    const { error } = await supabase
      .from('dispatch_points').update({ lat: NEW_LAT, lng: NEW_LNG })
      .eq('local_id', LOCAL_ID).eq('name', PASCO_NAME);
    if (error) throw error;
    console.log(`dispatch_points: updated ${dp.length} Pasco row(s)`);
  } else {
    const { error } = await supabase
      .from('dispatch_points').insert({ local_id: LOCAL_ID, name: PASCO_NAME, lat: NEW_LAT, lng: NEW_LNG });
    if (error) throw error;
    console.log('dispatch_points: inserted Pasco row');
  }

  console.log('Done — Pasco dispatch set to 702 N California Ave (46.240021, -119.080706)');
})().catch(e => { console.error('FAILED:', e.message || e); process.exit(1); });
