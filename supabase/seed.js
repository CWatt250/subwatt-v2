// ==========================================================================
// SubWatt v2 — Seed script (fixed for actual schema)
// One-time migration from data.json to Supabase.
//
// Usage:
//   node supabase/seed.js <supabase-url> <service-role-key>
//
// Service role key: Supabase → Settings → API → service_role secret
// Requires: npm install @supabase/supabase-js
// ==========================================================================

const { createClient } = require('@supabase/supabase-js');
const path    = require('path');
const fs      = require('fs');
const undici  = require('undici');

// Some Supabase regions cold-start slowly (locals 7/36 were hitting the
// default 10s TCP connect timeout). Widen both connect and headers timeouts.
undici.setGlobalDispatcher(new undici.Agent({
  connect:        { timeout: 60_000 },
  headersTimeout: 60_000,
  bodyTimeout:    60_000,
}));

const SUPABASE_URL     = process.argv[2];
const SUPABASE_SVC_KEY = process.argv[3];

if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
  console.error('Usage: node supabase/seed.js <supabase-url> <service-role-key>');
  process.exit(1);
}

// Custom fetch with 60s timeout — the default 10s undici timeout was firing
// on slow-cold Supabase responses (some upserts take 15s+).
const slowFetch = (url, opts = {}) => fetch(url, { ...opts, signal: AbortSignal.timeout(60000) });

const supabase = createClient(SUPABASE_URL, SUPABASE_SVC_KEY, {
  global: { fetch: slowFetch },
});

const dataPath = path.resolve(__dirname, '..', 'data.json');
const data     = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// Scalar fields stored as dedicated columns — everything else goes in rate_config
const SCALAR_KEYS = new Set([
  'name','color','hallCity','address','phone','bm',
  'cba','jurisdiction','subsNote','center','zoom','calcKind'
]);

async function seed() {
  console.log('Starting seed...\n');

  // -- 1. Locals ---------------------------------------------------------------
  for (const idStr of Object.keys(data.locals)) {
    const l = data.locals[idStr];

    // Non-scalar fields (travelZones, dispatches, appendixA, etc.) go in rate_config
    const rateConfig = {};
    for (const [k, v] of Object.entries(l)) {
      if (!SCALAR_KEYS.has(k)) rateConfig[k] = v;
    }

    const localRow = {
      id:           idStr,            // TEXT column - keep as string
      name:         l.name         || 'Local ' + idStr,
      color:        l.color        || '#2563eb',
      hall_city:    l.hallCity     || '',
      address:      l.address      || '',
      phone:        l.phone        || '',
      bm:           l.bm           || '',
      cba:          l.cba          || '',
      jurisdiction: l.jurisdiction || '',
      subs_note:    l.subsNote     || '',
      center:       l.center       || null,   // jsonb - pass array/object directly
      zoom:         l.zoom         != null ? l.zoom : 7,
      calc_kind:    l.calcKind     || 'zones',
      rate_config:  rateConfig,               // jsonb - plain object, no stringify
    };

    console.log('Seeding local ' + idStr + ' - ' + localRow.name);
    const { error } = await supabase
      .from('locals')
      .upsert(localRow, { onConflict: 'id' });

    if (error) {
      console.error('  FAILED: ' + error.message);
      if (error.details) console.error('  details: ' + error.details);
    } else {
      console.log('  OK');
    }

    // Dispatch points
    if (Array.isArray(l.dispatches)) {
      for (const dp of l.dispatches) {
        if (!dp.name) continue;
        const { error: dpErr } = await supabase
          .from('dispatch_points')
          .insert({ local_id: idStr, name: dp.name, lat: dp.lat, lng: dp.lng });
        if (dpErr && !dpErr.message.includes('duplicate')) {
          console.error('    dispatch "' + dp.name + '": ' + dpErr.message);
        }
      }
    }
  }

  // -- 2. Global config --------------------------------------------------------
  console.log('\nSeeding global_config...');

  const configRows = [
    { key: 'fipsToLocal', value: data.fipsToLocal },
    { key: 'stateAbbr',   value: data.stateAbbr   },
    { key: 'hanford',     value: data.hanford      },
  ];

  for (const row of configRows) {
    if (row.value == null) {
      console.log('  SKIP "' + row.key + '" - not found in data.json');
      continue;
    }

    const size = JSON.stringify(row.value).length;
    console.log('  "' + row.key + '" (~' + (size/1024).toFixed(1) + ' KB)');

    const { error } = await supabase
      .from('global_config')
      .upsert(row, { onConflict: 'key' });

    if (error) {
      console.error('  FAILED ' + row.key + ': ' + error.message);
      if (error.details) console.error('  details: ' + error.details);
    } else {
      console.log('  OK ' + row.key);
    }
  }

  console.log('\nSeed complete. Check Supabase -> Table Editor to verify.');
}

seed().catch(function(err) {
  console.error('Seed crashed:', err);
  process.exit(1);
});
