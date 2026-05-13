// One-off seed for the new locals extracted from CBAs/*.pdf.
// Reads /tmp/cba_data.json and upserts the 6 locals + dispatch points.
//
// Usage:
//   node supabase/seed_new.js <supabase-url> <service-role-key>

const { createClient } = require('@supabase/supabase-js');
const fs               = require('fs');
const undici           = require('undici');

undici.setGlobalDispatcher(new undici.Agent({
  connect:        { timeout: 60_000 },
  headersTimeout: 60_000,
  bodyTimeout:    60_000,
}));

const SUPABASE_URL     = process.argv[2];
const SUPABASE_SVC_KEY = process.argv[3];
const DATA_PATH        = process.argv[4] || '/tmp/cba_data.json';

if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
  console.error('Usage: node supabase/seed_new.js <supabase-url> <service-role-key> [data-path]');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);
const data     = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));

const SCALAR_KEYS = new Set([
  'name','color','hallCity','address','phone','bm',
  'cba','jurisdiction','subsNote','center','zoom','calcKind'
]);

async function seed() {
  for (const idStr of Object.keys(data)) {
    const l = data[idStr];

    const rateConfig = {};
    for (const [k, v] of Object.entries(l)) {
      if (k === 'id') continue;
      if (!SCALAR_KEYS.has(k)) rateConfig[k] = v;
    }

    const localRow = {
      id:           idStr,
      name:         l.name         || ('Local ' + idStr),
      color:        l.color        || '#2563eb',
      hall_city:    l.hallCity     || '',
      address:      l.address      || '',
      phone:        l.phone        || '',
      bm:           l.bm           || '',
      cba:          l.cba          || '',
      jurisdiction: l.jurisdiction || '',
      subs_note:    l.subsNote     || '',
      center:       l.center       || null,
      zoom:         l.zoom         != null ? l.zoom : 6,
      calc_kind:    l.calcKind     || 'zones',
      rate_config:  rateConfig,
    };

    console.log('Seeding local ' + idStr + ' - ' + localRow.name);
    const { error } = await supabase
      .from('locals')
      .upsert(localRow, { onConflict: 'id' });

    if (error) {
      console.error('  FAILED: ' + error.message);
      if (error.details) console.error('  details: ' + error.details);
      continue;
    }
    console.log('  OK');

    // Wipe and re-insert dispatch points (idempotent)
    await supabase.from('dispatch_points').delete().eq('local_id', idStr);

    if (Array.isArray(l.dispatches)) {
      for (const dp of l.dispatches) {
        if (!dp.name) continue;
        const { error: dpErr } = await supabase
          .from('dispatch_points')
          .insert({ local_id: idStr, name: dp.name, lat: dp.lat, lng: dp.lng });
        if (dpErr) console.error('    dispatch "' + dp.name + '": ' + dpErr.message);
      }
    }
  }

  console.log('\nDone.');
}

seed().catch(function(err){ console.error('Seed crashed:', err); process.exit(1); });
