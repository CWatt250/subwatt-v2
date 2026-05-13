// ==========================================================================
// SubWatt v2 — Seed script
// One-time migration from ~/Dev/subwatt-v1/data.json to Supabase.
//
// Usage:
//   1. Create a Supabase project at supabase.com
//   2. Run schema.sql in the SQL Editor
//   3. Get your anon key + project URL from Settings → API
//   4. Run this script:
//      node supabase/seed.js <supabase-url> <anon-key>
//
// Requires: npm install @supabase/supabase-js
// ==========================================================================

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const SUPABASE_URL = process.argv[2];
const SUPABASE_ANON_KEY = process.argv[3];

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Usage: node supabase/seed.js <supabase-url> <anon-key>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Load data.json
const dataPath = path.resolve(__dirname, '..', 'data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

async function seed() {
  console.log('Starting seed...');

  // ---- Insert locals ----
  const localIds = Object.keys(data.locals);
  for (const id of localIds) {
    const l = data.locals[id];

    // Extract scalar fields kept at the top level
    const localRow = {
      id,
      name: l.name || `Local ${id}`,
      color: l.color || '#2563eb',
      hall_city: l.hallCity || '',
      address: l.address || '',
      phone: l.phone || '',
      bm: l.bm || '',
      cba: l.cba || '',
      jurisdiction: l.jurisdiction || '',
      subs_note: l.subsNote || '',
      center: l.center ? JSON.stringify(l.center) : '[0,0]',
      zoom: l.zoom ?? 7,
      calc_kind: l.calcKind || 'zones',
      // The rest of the local structure goes in rate_config as JSONB
      rate_config: buildRateConfig(l),
    };

    console.log(`  Seeding local ${id} — ${localRow.name}`);
    const { error } = await supabase.from('locals').upsert(localRow, {
      onConflict: 'id',
      ignoreDuplicates: false,
    });
    if (error) {
      console.error(`  Failed to upsert local ${id}:`, error.message);
      continue;
    }

    // ---- Insert dispatch points ----
    if (Array.isArray(l.dispatches)) {
      for (const dp of l.dispatches) {
        if (!dp.name) continue;
        const { error: dpErr } = await supabase.from('dispatch_points').insert({
          local_id: id,
          name: dp.name,
          lat: dp.lat,
          lng: dp.lng,
        });
        if (dpErr) {
          console.error(`    Failed to insert dispatch "${dp.name}":`, dpErr.message);
        }
      }
    }
  }

  // ---- Hanford (top-level, inserted as a special local) ----
  if (data.hanford) {
    const hanfordRow = {
      id: '__hanford__',
      name: 'Hanford (top-level)',
      color: '#ef4444',
      hall_city: 'Shared Hanford override',
      calc_kind: 'zones',
      rate_config: JSON.stringify(data.hanford),
    };
    console.log('  Seeding Hanford top-level override');
    const { error } = await supabase.from('locals').upsert(hanfordRow, {
      onConflict: 'id',
      ignoreDuplicates: false,
    });
    if (error) console.error('  Failed to upsert Hanford:', error.message);
  }

  console.log('Seed complete!');
}

function buildRateConfig(l) {
  // Extract only the non-scalar, non-dispatches fields that should go into rate_config.
  // Scalar fields are already stored as top-level columns.
  const config = {};
  const SCALAR_KEYS = new Set([
    'name', 'color', 'hallCity', 'address', 'phone', 'bm', 'cba',
    'jurisdiction', 'subsNote', 'center', 'zoom', 'calcKind', 'dispatches',
  ]);
  for (const [key, val] of Object.entries(l)) {
    if (!SCALAR_KEYS.has(key)) {
      config[key] = val;
    }
  }
  return JSON.stringify(config);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
