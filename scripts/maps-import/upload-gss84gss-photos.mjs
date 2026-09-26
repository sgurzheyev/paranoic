/**
 * Upload gss84gss Acc2 local JPEGs to Cloudflare R2 and attach to memory_gems.
 * Safe: no deletes, no insert-gems.mjs. Merge media_urls only.
 */
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

const HOME = process.env.HOME;
const PHOTOS_DIR = path.join(HOME, 'Downloads/paranoic_gss84gss_photos');
const MANIFEST = path.join(PHOTOS_DIR, 'manifest.json');
const USER_ID = '7b047ce2-1c47-45d9-8391-1908f4ce1e82';
const KEY_PREFIX = 'memory-gems/gss84gss';

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function slugify(name) {
  const map = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ye',
    'ж': 'zh', 'з': 'z', 'и': 'y', 'і': 'i', 'ї': 'yi', 'й': 'y', 'к': 'k', 'л': 'l',
    'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '',
    'ю': 'yu', 'я': 'ya', 'ы': 'y', 'э': 'e', 'ё': 'yo', 'ъ': '',
  };
  let s = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  s = s.replace(/[а-яёіїєґ]/g, (ch) => map[ch] || '');
  // Arabic / other non-latin → keep hex-ish short hash fallback later
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
  if (!s || s.length < 2) {
    // stable short slug from unicode name
    let h = 0;
    for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    s = `place-${h.toString(16)}`;
  }
  return s.slice(0, 60);
}

function normalizeTitle(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[—–−]/g, '-')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // klub/club synonym
    .replace(/\bklub\b/g, 'club');
}

function scoreMatch(placeNorm, gemNorm) {
  if (!placeNorm || !gemNorm) return 0;
  if (placeNorm === gemNorm) return 100;
  if (gemNorm.includes(placeNorm) || placeNorm.includes(gemNorm)) return 90;
  const pa = placeNorm.split(' ').filter(Boolean);
  const ga = gemNorm.split(' ').filter(Boolean);
  if (!pa.length || !ga.length) return 0;
  const setG = new Set(ga);
  const overlap = pa.filter((w) => setG.has(w)).length;
  const ratio = overlap / Math.max(pa.length, ga.length);
  if (ratio >= 0.6) return Math.round(70 + ratio * 20);
  // first significant token
  if (pa[0].length >= 4 && ga[0] === pa[0]) return 65;
  return 0;
}

function isGoogleHotlink(url) {
  return /googleusercontent\.com|ggpht\.com|googleapis\.com\/.*maps/i.test(url || '');
}

function mergeMediaUrls(existing, r2Urls) {
  const prev = Array.isArray(existing) ? existing.filter((u) => typeof u === 'string' && u) : [];
  const nonGoogle = prev.filter((u) => !isGoogleHotlink(u));
  // Prefer replace dead Google URLs for this gem with our R2 set; keep any non-Google.
  const merged = [...r2Urls];
  for (const u of nonGoogle) {
    if (!merged.includes(u)) merged.push(u);
  }
  return merged;
}

async function main() {
  const env = loadEnv(path.join(HOME, 'paranoic/.env'));
  const required = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_R2_ACCOUNT_ID',
    'VITE_R2_ACCESS_KEY_ID',
    'VITE_R2_SECRET_ACCESS_KEY',
    'VITE_R2_BUCKET',
    'VITE_R2_PUBLIC_URL',
  ];
  for (const k of required) {
    if (!env[k]) throw new Error(`Missing env ${k}`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const photos = manifest.photos || [];
  if (photos.length !== 18) {
    console.warn(`Expected 18 photos, got ${photos.length}`);
  }

  // Group by normalized title so "Klub Stage" + "Club Stage" merge.
  // Prefer nicer display title when choosing the map key (first seen, then prefer Latin Club).
  const displayAlias = {
    'club stage': 'Club Stage',
    'leeward shisha bar': 'Leeward Shisha Bar',
    'restauracja u siostr': 'Restauracja U Sióstr',
  };
  const byPlace = new Map(); // displayName -> items
  const normToDisplay = new Map();
  for (const p of photos) {
    const raw = p.place || 'Unknown';
    const norm = normalizeTitle(raw);
    let display = normToDisplay.get(norm);
    if (!display) {
      display = displayAlias[norm] || raw;
      normToDisplay.set(norm, display);
      byPlace.set(display, []);
    }
    byPlace.get(display).push(p);
  }

  console.log('Places:', [...byPlace.keys()].map((k) => `${k} (${byPlace.get(k).length})`).join('; '));

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${env.VITE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.VITE_R2_ACCESS_KEY_ID,
      secretAccessKey: env.VITE_R2_SECRET_ACCESS_KEY,
    },
  });
  const bucket = env.VITE_R2_BUCKET;
  const publicBase = env.VITE_R2_PUBLIC_URL.replace(/\/$/, '');

  const uploaded = []; // { place, filename, key, url }
  for (const [place, items] of byPlace) {
    const slug = slugify(place);
    // Sort by filename for stable nn
    items.sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
    let nn = 1;
    for (const item of items) {
      const filePath = path.join(PHOTOS_DIR, item.filename);
      if (!fs.existsSync(filePath)) throw new Error(`Missing file ${filePath}`);
      const body = fs.readFileSync(filePath);
      const key = `${KEY_PREFIX}/${slug}/${String(nn).padStart(2, '0')}.jpg`;
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );
      const url = `${publicBase}/${key}`;
      uploaded.push({ place, filename: item.filename, key, url, bytes: body.length });
      console.log(`R2 OK ${item.filename} -> ${key} (${body.length} bytes)`);
      nn++;
    }
  }

  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  const { data: gems, error: ge } = await supabase
    .from('memory_gems')
    .select('id,title,address,media_urls,metadata,user_id')
    .eq('user_id', USER_ID);
  if (ge) throw new Error(`fetch gems: ${ge.message}`);

  const gemNorms = gems.map((g) => ({ gem: g, norm: normalizeTitle(g.title) }));

  const urlsByPlace = new Map();
  for (const u of uploaded) {
    if (!urlsByPlace.has(u.place)) urlsByPlace.set(u.place, []);
    urlsByPlace.get(u.place).push(u.url);
  }

  const updated = [];
  const created = [];
  const matchFailures = [];

  for (const [place, r2Urls] of urlsByPlace) {
    const placeNorm = normalizeTitle(place);
    let best = null;
    let bestScore = 0;
    for (const { gem, norm } of gemNorms) {
      const sc = scoreMatch(placeNorm, norm);
      if (sc > bestScore) {
        bestScore = sc;
        best = gem;
      }
    }

    if (best && bestScore >= 65) {
      const merged = mergeMediaUrls(best.media_urls, r2Urls);
      const meta = {
        ...(best.metadata || {}),
        gss84gss_photos: true,
        gss84gss_attached_at: new Date().toISOString(),
        gss84gss_match_score: bestScore,
        gss84gss_place_label: place,
      };
      const { error: ue } = await supabase
        .from('memory_gems')
        .update({ media_urls: merged, metadata: meta })
        .eq('id', best.id);
      if (ue) throw new Error(`update ${best.title}: ${ue.message}`);
      updated.push({
        place,
        gemId: best.id,
        gemTitle: best.title,
        score: bestScore,
        mediaCount: merged.length,
        sample: merged[0],
      });
      console.log(`UPDATE gem "${best.title}" <- ${place} (score=${bestScore}) urls=${merged.length}`);
    } else {
      matchFailures.push({ place, bestTitle: best?.title || null, bestScore });
      const row = {
        user_id: USER_ID,
        title: place,
        address: null,
        media_urls: r2Urls,
        gem_type: 'photo',
        visibility: 'private',
        is_private: true,
        metadata: {
          source: 'gss84gss',
          gss84gss_photos: true,
          gss84gss_created_at: new Date().toISOString(),
          note: 'Created from gss84gss Acc2 photo scrape; no Acc1 gem match',
        },
      };
      const { data: ins, error: ie } = await supabase
        .from('memory_gems')
        .insert(row)
        .select('id,title,media_urls')
        .single();
      if (ie) throw new Error(`insert ${place}: ${ie.message}`);
      created.push({
        place,
        gemId: ins.id,
        gemTitle: ins.title,
        mediaCount: (ins.media_urls || []).length,
        sample: (ins.media_urls || [])[0],
        priorBest: best?.title || null,
        priorScore: bestScore,
      });
      console.log(`INSERT gem "${place}" (no match; best=${best?.title || 'n/a'} score=${bestScore})`);
    }
  }

  // Verify public URLs (HEAD a few)
  const sampleUrls = uploaded.slice(0, 3).map((u) => u.url);
  const headChecks = [];
  for (const url of sampleUrls) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      headChecks.push({ url, status: res.status, contentType: res.headers.get('content-type') });
    } catch (e) {
      headChecks.push({ url, error: String(e.message || e) });
    }
  }

  const summary = {
    r2UploadCount: uploaded.length,
    places: [...urlsByPlace.keys()],
    gemsUpdated: updated.length,
    gemsCreated: created.length,
    matchFailuresBeforeInsert: matchFailures,
    updated,
    created,
    samplePublicUrls: uploaded.slice(0, 5).map((u) => u.url),
    headChecks,
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  const outPath = path.join(PHOTOS_DIR, '_upload_result.json');
  fs.writeFileSync(outPath, JSON.stringify({ ...summary, allUploaded: uploaded }, null, 2));
  console.log('Wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
