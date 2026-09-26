/**
 * Safe enrich pass #2: geocode remaining gems with simplified Nominatim queries.
 * No deletes / no blind inserts.
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

const env = loadEnv(path.join(process.env.HOME, 'paranoic/.env'));
const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY
);
const USER_ID = '7b047ce2-1c47-45d9-8391-1908f4ce1e82';
const JUNK_TITLE_RE = /local guide level|^unknown place$/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasCoords(g) {
  if (g.latitude != null && g.longitude != null) return true;
  const m = g.metadata || {};
  return m.lat != null && m.lng != null;
}

async function geocode(query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return null;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ParanoicApp/1.0 (memory-gems-import; contact@paranoic.men)' },
  });
  if (!res.ok) {
    console.warn(`  HTTP ${res.status} for ${q}`);
    return null;
  }
  const data = await res.json();
  if (data?.length) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), q };
  return null;
}

function queryCandidates(title, address) {
  const addr = (address || '').trim();
  const badAddr =
    !addr ||
    addr.length < 4 ||
    /local guide|unfortunately|we're not able|learn more/i.test(addr);
  const out = [];
  const push = (x) => {
    const s = String(x || '').replace(/\s+/g, ' ').trim();
    if (s.length >= 3 && !out.includes(s)) out.push(s);
  };

  if (!badAddr) {
    // full address
    push(addr);
    // drop postal / trailing country code noise: keep city-ish tail
    push(addr.replace(/\b\d{4,6}\b/g, ' ').replace(/\s+/g, ' ').trim());
    // street + last two comma parts (city, country)
    const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) push(parts.slice(0, 2).join(', '));
    if (parts.length >= 3) push(`${parts[0]}, ${parts[parts.length - 2]}, ${parts[parts.length - 1]}`);
    if (parts.length >= 2) push(parts.slice(-2).join(', ')); // city, country
    // title + city/country
    if (title && parts.length >= 2) push(`${title}, ${parts.slice(-2).join(', ')}`);
  }
  if (title) {
    push(title);
    // title without parentheticals
    push(title.replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim());
  }
  return out;
}

async function run() {
  const { data: gems, error } = await supabase
    .from('memory_gems')
    .select('id,title,address,latitude,longitude,metadata')
    .eq('user_id', USER_ID);
  if (error) throw new Error(error.message);

  const need = gems.filter((g) => !hasCoords(g) && !JUNK_TITLE_RE.test(g.title || ''));
  console.log(`Need geocode (non-junk): ${need.length}`);

  let ok = 0, fail = 0;
  for (let i = 0; i < need.length; i++) {
    const g = need[i];
    const candidates = queryCandidates(g.title, g.address);
    console.log(`[${i + 1}/${need.length}] ${g.title} candidates=${candidates.length}`);
    let coords = null;
    for (const c of candidates) {
      coords = await geocode(c);
      await sleep(1100);
      if (coords) {
        console.log(`  OK via "${coords.q}" -> [${coords.lat}, ${coords.lng}]`);
        break;
      }
    }
    if (!coords) {
      console.log('  FAIL all candidates');
      fail++;
      continue;
    }
    const meta = { ...(g.metadata || {}), lat: coords.lat, lng: coords.lng, geocode_query: coords.q };
    const { error: ue } = await supabase
      .from('memory_gems')
      .update({ latitude: coords.lat, longitude: coords.lng, metadata: meta })
      .eq('id', g.id);
    if (ue) {
      console.error('  update fail', ue.message);
      fail++;
    } else ok++;
  }

  const { data: finalGems } = await supabase
    .from('memory_gems')
    .select('id,title,latitude,longitude,media_urls,metadata')
    .eq('user_id', USER_ID);
  const withCol = finalGems.filter((g) => g.latitude != null && g.longitude != null).length;
  const stillMissing = finalGems.filter((g) => g.latitude == null && !(g.metadata?.lat != null)).map((g) => g.title);

  console.log('\n=== SUMMARY PASS2 ===');
  console.log(JSON.stringify({ geocodeOk: ok, geocodeFail: fail, withLatLngColumns: withCol, total: finalGems.length, stillMissing }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
