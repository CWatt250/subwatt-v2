// De-duplicate dispatch_points rows that accumulated from multiple seed runs.

const { createClient } = require('@supabase/supabase-js');
const undici           = require('undici');

undici.setGlobalDispatcher(new undici.Agent({
  connect:        { timeout: 60_000 },
  headersTimeout: 60_000,
  bodyTimeout:    60_000,
}));

const SUPABASE_URL     = process.argv[2];
const SUPABASE_SVC_KEY = process.argv[3];
const supabase         = createClient(SUPABASE_URL, SUPABASE_SVC_KEY);

(async function(){
  const { data: rows, error } = await supabase
    .from('dispatch_points')
    .select('*')
    .order('id');
  if (error) { console.error(error); process.exit(1); }

  const keep = new Map();         // key = local|name, value = id-to-keep
  const toDelete = [];
  rows.forEach(function(r){
    const key = r.local_id + '|' + r.name;
    if (keep.has(key)) toDelete.push(r.id);
    else               keep.set(key, r.id);
  });

  console.log('total=' + rows.length + '  keep=' + keep.size + '  delete=' + toDelete.length);
  if (!toDelete.length) return;

  const chunk = 100;
  for (let i = 0; i < toDelete.length; i += chunk) {
    const slice = toDelete.slice(i, i + chunk);
    const { error: e } = await supabase.from('dispatch_points').delete().in('id', slice);
    if (e) console.error('chunk failed:', e.message);
    else   console.log('deleted ids ' + slice[0] + '...' + slice[slice.length-1]);
  }

  const { data: after } = await supabase.from('dispatch_points').select('local_id,name').order('local_id');
  console.log('after dedupe:', after.length, 'rows');
})();
