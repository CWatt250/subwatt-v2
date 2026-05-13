// Build a full fipsToLocal mapping for all 9 locals using county
// GeoJSON as a name→FIPS lookup. Upserts the result into
// global_config.fipsToLocal. The original 3 locals (7, 36, 82) keep their
// existing mappings; locals 16, 28, 69, 73, 76, 135 get added.

const fs               = require('fs');
const { createClient } = require('@supabase/supabase-js');
const undici           = require('undici');
undici.setGlobalDispatcher(new undici.Agent({
  connect: { timeout: 60_000 }, headersTimeout: 60_000, bodyTimeout: 60_000,
}));

const SUPABASE_URL     = process.argv[2];
const SUPABASE_SVC_KEY = process.argv[3];
const supabase         = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);

const counties = JSON.parse(fs.readFileSync('/tmp/counties_filtered.json','utf8'));

// Index: state FIPS prefix → array of fips strings
const byState = {};
// Lookup: state FIPS + lowercase name → fips
const byNameState = {};
counties.features.forEach(f => {
  const fips = String(f.id).padStart(5,'0');
  const state = fips.slice(0,2);
  const name  = String(f.properties.name).toLowerCase().replace(/[^a-z ]/g,'').trim();
  if (!byState[state]) byState[state] = [];
  byState[state].push(fips);
  byNameState[state + '|' + name] = fips;
});

function statewide(stateFips) { return (byState[stateFips] || []).slice(); }

function listFips(stateFips, names) {
  const out = [];
  const miss = [];
  names.forEach(raw => {
    const cleaned = String(raw).toLowerCase().replace(/[^a-z ]/g,'').replace(/ county\b/,'').trim();
    const fips = byNameState[stateFips + '|' + cleaned];
    if (fips) out.push(fips);
    else miss.push(raw);
  });
  if (miss.length) console.warn('  missing in state ' + stateFips + ':', miss.join(', '));
  return out;
}

const map = {};
function assign(localId, fipsArr) {
  fipsArr.forEach(f => { map[f] = Number(localId); });
}

// Local 7 — Western WA (Snohomish and south; Pacific coast counties)
// Keep existing list from data.json so we don't disturb the original mapping.
const ORIG = JSON.parse(fs.readFileSync('data.json','utf8')).fipsToLocal;
Object.entries(ORIG).forEach(([f,lid]) => { map[f] = Number(lid); });

// Local 28 — Colorado statewide + SE Wyoming (Albany, Carbon, Goshen, Laramie, Niobrara, Platte)
assign(28, statewide('08'));
assign(28, listFips('56', ['Albany','Carbon','Goshen','Laramie','Niobrara','Platte']));

// Local 73 — Arizona statewide
assign(73, statewide('04'));

// Local 69 — Utah statewide + White Pine, Eureka, Elko NV + Sweetwater, Uinta, Lincoln WY + Bear Lake, Franklin, Caribou, Bannock, Bingham, Bonneville ID
assign(69, statewide('49'));
assign(69, listFips('32', ['White Pine','Eureka','Elko']));
assign(69, listFips('56', ['Sweetwater','Uinta','Lincoln']));
assign(69, listFips('16', ['Bear Lake','Franklin','Caribou','Bannock','Bingham','Bonneville','Power','Oneida','Cassia']));

// Local 16 — Northern California + Northern Nevada (Washoe)
assign(16, listFips('06', [
  'Alameda','Contra Costa','Marin','Napa','San Francisco','San Mateo','Santa Clara','Solano','Sonoma',
  'Sacramento','Yolo','Sutter','Placer','El Dorado','Nevada','Sierra','Plumas','Lassen','Modoc','Siskiyou','Shasta','Tehama','Glenn','Butte','Colusa','Yuba',
  'Mendocino','Lake','Humboldt','Del Norte','Trinity',
  'San Joaquin','Stanislaus','Merced','Madera','Mariposa','Tuolumne','Calaveras','Amador','Alpine',
  'Monterey','San Benito','Santa Cruz']));
assign(16, listFips('32', ['Washoe','Carson City','Storey','Douglas','Lyon','Mineral','Pershing','Humboldt','Lander','Churchill']));

// Local 76 — Most of NM (excluding the SW counties that belong elsewhere) + W TX (6 counties) + SW CO (5 counties)
// Take all NM counties statewide as a simple/safe baseline.
assign(76, statewide('35'));
assign(76, listFips('48', ['Brewster','Culberson','El Paso','Hudspeth','Jeff Davis','Presidio']));
// Override the 5 SW CO counties (overwrites Local 28's claim for those)
assign(76, listFips('08', ['Archuleta','Conejos','Costilla','La Plata','Montezuma']));

// Local 135 — Southern Nevada (Clark, Lincoln, Nye, Esmeralda)
assign(135, listFips('32', ['Clark','Lincoln','Nye','Esmeralda']));

// Summary
const counts = {};
Object.values(map).forEach(v => { counts[v] = (counts[v]||0)+1; });
console.log('fipsToLocal totals:', counts);
console.log('total entries     :', Object.keys(map).length);

(async function(){
  console.log('Upserting global_config.fipsToLocal…');
  const { error } = await supabase
    .from('global_config')
    .upsert({ key: 'fipsToLocal', value: map }, { onConflict: 'key' });
  if (error) {
    console.error('FAILED:', error.message);
    process.exit(1);
  }
  // Also update stateAbbr to include CA, UT, AZ, NM, CO, TX
  const newStateAbbr = { '16':'ID','30':'MT','32':'NV','41':'OR','53':'WA','56':'WY','06':'CA','08':'CO','04':'AZ','35':'NM','48':'TX','49':'UT' };
  const { error: e2 } = await supabase
    .from('global_config')
    .upsert({ key: 'stateAbbr', value: newStateAbbr }, { onConflict: 'key' });
  if (e2) console.error('stateAbbr FAILED:', e2.message);
  else    console.log('stateAbbr updated:', newStateAbbr);

  console.log('OK');
})();
