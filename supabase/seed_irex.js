// Geocode 9 Irex Argus branch addresses via Mapbox and seed them into
// global_config.irex_branches. We store branches as a JSON value in
// global_config rather than a separate table because:
//   (a) service_role key gives us PostgREST/data access but no DDL, and
//   (b) for 9 rows a key-value blob is fine.
// schema.sql is updated separately so the table-shaped migration is
// still on disk if you ever want to move to a proper table.

const { createClient } = require('@supabase/supabase-js');
const undici           = require('undici');
undici.setGlobalDispatcher(new undici.Agent({
  connect: { timeout: 60_000 }, headersTimeout: 60_000, bodyTimeout: 60_000,
}));

const MAPBOX_TOKEN = 'pk.eyJ1IjoiY3dhdHQtMjUwIiwiYSI6ImNtb2FjZ2k1ODA1NnEyd29pdjVxOWFxcTcifQ.iAwWLU3RLVav57dM4UuisQ';

const SUPABASE_URL     = process.argv[2];
const SUPABASE_SVC_KEY = process.argv[3];
const supabase         = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);

const BRANCHES = [
  { name:'Billings',        address:'131 Brickyard Lane',         city:'Billings',         state:'MT', zip:'59101', phone:'406-409-3352' },
  { name:'Boise',           address:'8625 E Cash Lane Suite A',   city:'Nampa',            state:'ID', zip:'83687', phone:'720-306-9666' },
  { name:'Elko',            address:'261 W Commercial Street',    city:'Elko',             state:'NV', zip:'89801', phone:'775-340-8368' },
  { name:'Los Angeles',     address:'11807 Smith Avenue',         city:'Santa Fe Springs', state:'CA', zip:'90670', phone:'562-422-7370' },
  { name:'Pasco',           address:'702 N California Avenue',    city:'Pasco',            state:'WA', zip:'99301', phone:'509-870-4880' },
  { name:'Phoenix',         address:'101 South Rockford Drive',   city:'Tempe',            state:'AZ', zip:'85281', phone:'480-921-4116' },
  { name:'Portland',        address:'4252 SE International Way Suite H', city:'Milwaukie', state:'OR', zip:'97222', phone:'971-231-5758' },
  { name:'Salt Lake City',  address:'645 N Taylor Way Suite 400', city:'North Salt Lake City', state:'UT', zip:'84054', phone:'801-834-5918' },
  { name:'Seattle',         address:'18401 E Valley Hwy',         city:'Kent',             state:'WA', zip:'98032', phone:'425-207-3292' },
];

async function geocode(b) {
  const q = `${b.address}, ${b.city}, ${b.state} ${b.zip}`;
  const url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(q) + '.json?country=us&limit=1&access_token=' + MAPBOX_TOKEN;
  const r = await fetch(url);
  const d = await r.json();
  if (!d.features || !d.features.length) throw new Error('no geocode result for ' + q);
  const [lng, lat] = d.features[0].center;
  return { lat, lng };
}

(async function(){
  const enriched = [];
  for (let i = 0; i < BRANCHES.length; i++) {
    const b = BRANCHES[i];
    const { lat, lng } = await geocode(b);
    const row = { id: i + 1, ...b, lat, lng, active: true };
    enriched.push(row);
    console.log(`#${row.id} ${row.name.padEnd(16)} → ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  }

  const { error } = await supabase
    .from('global_config')
    .upsert({ key:'irex_branches', value: enriched }, { onConflict: 'key' });
  if (error) { console.error('FAILED:', error.message); process.exit(1); }
  console.log('\nSeeded', enriched.length, 'branches into global_config.irex_branches');
})().catch(err => { console.error(err); process.exit(1); });
