// Patch each local's rate_config.region (short label for the sidebar card).

const { createClient } = require('@supabase/supabase-js');
const undici           = require('undici');
undici.setGlobalDispatcher(new undici.Agent({
  connect: { timeout: 60_000 }, headersTimeout: 60_000, bodyTimeout: 60_000,
}));

const REGIONS = {
  '7':   'Western Washington',
  '16':  'Northern CA · N. Nevada',
  '28':  'Colorado · SE Wyoming',
  '36':  'Oregon · SW Washington',
  '69':  'Utah · parts of NV/WY/ID',
  '73':  'Arizona',
  '76':  'New Mexico · W Texas · SW CO',
  '82':  'E. Washington · N. Idaho · Montana',
  '135': 'Southern Nevada',
};

const supa = createClient(process.argv[2], process.argv[3]);

(async function(){
  for (const id of Object.keys(REGIONS)) {
    const { data: row, error } = await supa.from('locals').select('rate_config').eq('id', id).single();
    if (error) { console.error(id, error.message); continue; }
    const rc = row.rate_config || {};
    rc.region = REGIONS[id];
    const { error: upErr } = await supa.from('locals').update({ rate_config: rc }).eq('id', id);
    if (upErr) console.error(id, upErr.message);
    else       console.log(id, '->', REGIONS[id]);
  }
})();
