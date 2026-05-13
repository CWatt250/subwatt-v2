// Fill in every Idaho and Wyoming county that isn't already mapped in
// fipsToLocal. Source-of-truth: the Local 69, 82, and 28 jurisdictions
// as written in their CBAs.

const fs               = require('fs');
const { createClient } = require('@supabase/supabase-js');
const undici           = require('undici');
undici.setGlobalDispatcher(new undici.Agent({
  connect: { timeout: 60_000 }, headersTimeout: 60_000, bodyTimeout: 60_000,
}));

const supabase = createClient(process.argv[2], process.argv[3]);
const counties = JSON.parse(fs.readFileSync('/tmp/counties_filtered.json','utf8'));

const byName = {};   // state|name → fips
counties.features.forEach(f => {
  const fips = String(f.id).padStart(5,'0');
  const state = fips.slice(0,2);
  const name  = String(f.properties.name).toLowerCase().replace(/[^a-z ]/g,'').trim();
  byName[state + '|' + name] = fips;
});

function lookup(stateFips, names) {
  const out = [];
  const miss = [];
  names.forEach(n => {
    const key = stateFips + '|' + String(n).toLowerCase().trim();
    const fips = byName[key];
    if (fips) out.push(fips);
    else miss.push(n);
  });
  if (miss.length) console.warn('  missing in', stateFips, ':', miss.join(', '));
  return out;
}

// Local 69 Idaho counties — full list from CBA
const L69_ID = [
  'Washington','Gem','Payette','Canyon','Ada','Boise','Elmore','Owyhee',
  'Custer','Camas','Blaine','Butte','Clark','Jefferson','Twin Falls','Cassia',
  'Power','Bannock','Caribou','Oneida','Franklin','Bear Lake','Adams','Valley',
  'Lemhi','Gooding','Lincoln','Jerome','Minidoka','Bingham','Fremont','Madison',
  'Teton','Bonneville'
];
// Local 82 Idaho counties — northern panhandle
const L82_ID = [
  'Benewah','Bonner','Boundary','Clearwater','Idaho','Kootenai','Latah','Lewis','Nez Perce','Shoshone'
];
// Local 69 Wyoming
const L69_WY = ['Sweetwater','Uinta','Lincoln','Sublette','Teton','Fremont','Park','Hot Springs'];
// Local 28 Wyoming
const L28_WY = [
  'Albany','Big Horn','Campbell','Carbon','Converse','Crook','Goshen','Johnson',
  'Laramie','Natrona','Niobrara','Platte','Sheridan','Washakie','Weston'
];

(async function(){
  const { data: row, error: e1 } = await supabase
    .from('global_config').select('value').eq('key','fipsToLocal').single();
  if (e1) { console.error(e1); process.exit(1); }
  const map = row.value;

  const before = Object.keys(map).length;

  function assign(localId, fipsArr){
    fipsArr.forEach(f => { map[f] = Number(localId); });
  }
  assign(69, lookup('16', L69_ID));
  assign(82, lookup('16', L82_ID));
  assign(69, lookup('56', L69_WY));
  assign(28, lookup('56', L28_WY));

  // Sanity — check every ID + WY county now has an assignment
  const idAll = counties.features.filter(f => String(f.id).slice(0,2) === '16').map(f => f.id);
  const wyAll = counties.features.filter(f => String(f.id).slice(0,2) === '56').map(f => f.id);
  const unmappedId = idAll.filter(f => !map[f]);
  const unmappedWy = wyAll.filter(f => !map[f]);
  console.log('Unmapped Idaho counties :', unmappedId.length, unmappedId);
  console.log('Unmapped Wyoming counties:', unmappedWy.length, unmappedWy);

  const after = Object.keys(map).length;
  console.log('total entries: ' + before + ' → ' + after + ' (+' + (after-before) + ')');

  const { error: e2 } = await supabase
    .from('global_config').upsert({ key:'fipsToLocal', value: map }, { onConflict: 'key' });
  if (e2) { console.error(e2); process.exit(1); }
  console.log('OK');
})();
