// Reassign the five east-of-Cascade-crest WA counties from Local 7 to
// Local 82 in global_config.fipsToLocal, and fix Local 7's jurisdiction
// text (it wrongly listed the eastern counties). Local 82's own description
// ("19 counties east of Cascade crest") requires exactly these five on top
// of the 14 it already had: Chelan, Douglas, Kittitas, Okanogan, Yakima.
//
// Usage: node supabase/fix_eastern_wa.js <SUPABASE_URL> <SERVICE_ROLE_KEY>
const { createClient } = require('@supabase/supabase-js');
const undici           = require('undici');
undici.setGlobalDispatcher(new undici.Agent({
  connect: { timeout: 60_000 }, headersTimeout: 60_000, bodyTimeout: 60_000,
}));

const SUPABASE_URL = process.argv[2];
const SVC_KEY      = process.argv[3];
if (!SUPABASE_URL || !SVC_KEY) {
  console.error('Usage: node supabase/fix_eastern_wa.js <SUPABASE_URL> <SERVICE_ROLE_KEY>');
  process.exit(1);
}

const REASSIGN = {
  '53007': 82,  // Chelan
  '53017': 82,  // Douglas
  '53037': 82,  // Kittitas
  '53047': 82,  // Okanogan
  '53077': 82,  // Yakima
};

const LOCAL7_JURISDICTION =
  'Western Washington: Clallam, Grays Harbor, Island, Jefferson, King, ' +
  'Kitsap, Lewis, Mason, Pacific, Pierce, San Juan, Skagit, Snohomish, ' +
  'Thurston, and Whatcom counties.';

(async () => {
  const supabase = createClient(SUPABASE_URL, SVC_KEY);

  const { data: row, error: readErr } = await supabase
    .from('global_config').select('value').eq('key', 'fipsToLocal').single();
  if (readErr) throw readErr;

  const map = row.value;
  Object.entries(REASSIGN).forEach(([fips, lid]) => {
    console.log(`${fips}: ${map[fips]} -> ${lid}`);
    map[fips] = lid;
  });

  const { error: upErr } = await supabase
    .from('global_config')
    .upsert({ key: 'fipsToLocal', value: map }, { onConflict: 'key' });
  if (upErr) throw upErr;
  console.log('fipsToLocal updated.');

  const { error: jErr } = await supabase
    .from('locals')
    .update({ jurisdiction: LOCAL7_JURISDICTION, updated_at: new Date().toISOString() })
    .eq('id', '7');
  if (jErr) throw jErr;
  console.log('Local 7 jurisdiction text updated.');
  console.log('OK');
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
