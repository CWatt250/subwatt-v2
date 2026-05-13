// Tighten center+zoom per local so the sidebar's flyTo lands on a useful
// view of each jurisdiction instead of a faraway region-wide one.

const { createClient } = require('@supabase/supabase-js');
const undici           = require('undici');
undici.setGlobalDispatcher(new undici.Agent({
  connect: { timeout: 60_000 }, headersTimeout: 60_000, bodyTimeout: 60_000,
}));

// [lat, lng, zoom]
const VIEWS = {
  '7':   [47.5, -122.0, 7],   // Western WA (Puget Sound)
  '16':  [38.8, -121.8, 6],   // N CA + Reno
  '28':  [39.5, -105.7, 7],   // Colorado
  '36':  [44.0, -121.5, 6],   // Oregon + SW WA
  '69':  [39.7, -111.7, 7],   // Utah
  '73':  [34.2, -111.8, 7],   // Arizona
  '76':  [33.8, -106.5, 7],   // NM + W TX + SW CO
  '82':  [47.0, -110.5, 6],   // E WA + N ID + MT (was 5 — way too wide)
  '135': [37.0, -115.7, 7],   // S Nevada
};

const supa = createClient(process.argv[2], process.argv[3]);

(async function(){
  for (const id of Object.keys(VIEWS)) {
    const [lat, lng, zoom] = VIEWS[id];
    const { error } = await supa.from('locals').update({ center: [lat, lng], zoom }).eq('id', id);
    if (error) console.error(id, error.message);
    else       console.log(id, '->', [lat, lng], 'zoom', zoom);
  }
})();
