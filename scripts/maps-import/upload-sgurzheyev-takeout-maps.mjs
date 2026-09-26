/**
 * Upload sgurzheyev Acc1 Google Takeout Maps JPEGs to Cloudflare R2 and attach to memory_gems.
 * Safe: no deletes, do NOT run insert-gems.mjs. Merge media_urls only.
 * Modeled on upload-gss84gss-photos.mjs.
 */
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const HOME = process.env.HOME || '/home/box';
const WORKSPACE = '/workspace';

// Prefer box fallback layout; also support Mac paths if present.
const PHOTOS_DIR_CANDIDATES = [
  path.join(WORKSPACE, 'paranoic_sgurzheyev_maps/Takeout/Maps/Photos and videos'),
  path.join(HOME, 'Downloads/paranoic_sgurzheyev_maps'),
  path.join(HOME, 'Downloads/paranoic_sgurzheyev_maps/Takeout/Maps/Photos and videos'),
];
const META_DIR_CANDIDATES = [
  path.join(WORKSPACE, 'paranoic_sgurzheyev_maps/Takeout/Maps (your places)'),
  path.join(WORKSPACE, 'paranoic_sgurzheyev_maps/_meta'),
  path.join(HOME, 'Downloads/paranoic_sgurzheyev_maps/_meta'),
  path.join(HOME, 'Downloads/paranoic_sgurzheyev_maps/Takeout/Maps (your places)'),
];
const PLACES_CANDIDATES = [
  path.join(WORKSPACE, 'google_maps_places_acc1.json'),
  path.join(HOME, 'Downloads/google_maps_places_acc1.json'),
  path.join(HOME, 'Downloads/google_maps_places_full.json'),
];
const ENV_CANDIDATES = [
  path.join(WORKSPACE, 'paranoic.env'),
  path.join(HOME, 'paranoic/.env'),
];
const OUT_DIR_CANDIDATES = [
  path.join(WORKSPACE, 'paranoic_sgurzheyev_maps'),
  path.join(HOME, 'Downloads/paranoic_sgurzheyev_maps'),
];

const USER_ID = '7b047ce2-1c47-45d9-8391-1908f4ce1e82';
const KEY_PREFIX = 'memory-gems/sgurzheyev';
const UNMATCHED_TITLE = 'Takeout Maps (unmatched)';
const MATCH_RADIUS_M = 120;
const MATCH_RADIUS_FALLBACK_M = 200;

function firstExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

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
    а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ye',
    ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'yi', й: 'y', к: 'k', л: 'l',
    м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
    ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '',
    ю: 'yu', я: 'ya', ы: 'y', э: 'e', ё: 'yo', ъ: '',
  };
  let s = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  s = s.replace(/[а-яёіїєґ]/g, (ch) => map[ch] || '');
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
  if (!s || s.length < 2) {
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
  if (pa[0].length >= 4 && ga[0] === pa[0]) return 65;
  return 0;
}

function isGoogleHotlink(url) {
  return /googleusercontent\.com|ggpht\.com|googleapis\.com\/.*maps/i.test(url || '');
}

function mergeMediaUrls(existing, r2Urls) {
  const prev = Array.isArray(existing) ? existing.filter((u) => typeof u === 'string' && u) : [];
  const nonGoogle = prev.filter((u) => !isGoogleHotlink(u));
  const merged = [...r2Urls];
  for (const u of nonGoogle) {
    if (!merged.includes(u)) merged.push(u);
  }
  return merged;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseQFromUrl(url) {
  if (!url) return null;
  const m = String(url).match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  // q= is usually lat,lon
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b };
  return { lat: b, lon: a };
}

function loadGeoJsonPlaces(filePath, source) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const features = data.features || (Array.isArray(data) ? data : []);
  const out = [];
  for (const f of features) {
    const props = f.properties || {};
    const loc = props.location || {};
    const name = loc.name || props.name || props.Title || null;
    let lat = null;
    let lon = null;
    const coords = (f.geometry && f.geometry.coordinates) || null;
    if (Array.isArray(coords) && coords.length >= 2) {
      lon = coords[0];
      lat = coords[1];
    }
    if ((lat == null || lon == null || (lat === 0 && lon === 0)) && props.google_maps_url) {
      const q = parseQFromUrl(props.google_maps_url);
      if (q) {
        lat = q.lat;
        lon = q.lon;
      }
    }
    if (!name || lat == null || lon == null || (lat === 0 && lon === 0)) continue;
    out.push({
      name,
      lat,
      lon,
      address: loc.address || props.address || null,
      source,
    });
  }
  return out;
}

function loadAcc1Places(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const list = Array.isArray(data) ? data : data.places || data.features || [];
  const out = [];
  for (const p of list) {
    const name = p.name || p.title;
    if (!name || /Local Guide Level/i.test(name)) continue;
    const lat =
      p.lat ?? p.latitude ?? p.location?.lat ?? p.location?.latitude ?? null;
    const lon =
      p.lon ?? p.lng ?? p.longitude ?? p.location?.lng ?? p.location?.longitude ?? null;
    if (lat == null || lon == null) {
      // Acc1 dump often has name+address only — keep for name reference, skip geo match
      continue;
    }
    out.push({ name, lat, lon, address: p.address || null, source: 'acc1' });
  }
  return out;
}

function readPhotoGeo(sidecarPath) {
  if (!fs.existsSync(sidecarPath)) return null;
  const d = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  const g = d.geoDataExif || d.geoData || null;
  if (!g || g.latitude == null || g.longitude == null) return null;
  return { lat: g.latitude, lon: g.longitude };
}

function buildManifest(photosDir, placeCatalog) {
  const files = fs
    .readdirSync(photosDir)
    .filter((f) => /\.jpe?g$/i.test(f) && !f.endsWith('.json'));
  const photos = [];
  let matched = 0;
  let unmatched = 0;

  const matchOne = (lat, lon, radius) => {
    let best = null;
    let bestDist = Infinity;
    for (const p of placeCatalog) {
      const d = haversineMeters(lat, lon, p.lat, p.lon);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (best && bestDist <= radius) return { place: best, dist: bestDist };
    return null;
  };

  for (const filename of files.sort()) {
    const sidecar = path.join(photosDir, `${filename}.json`);
    const geo = readPhotoGeo(sidecar);
    let placeName = UNMATCHED_TITLE;
    let lat = geo?.lat ?? null;
    let lon = geo?.lon ?? null;
    let matchDist = null;
    let matchSource = null;

    if (geo) {
      let hit = matchOne(geo.lat, geo.lon, MATCH_RADIUS_M);
      if (!hit) hit = matchOne(geo.lat, geo.lon, MATCH_RADIUS_FALLBACK_M);
      if (hit) {
        placeName = hit.place.name;
        matchDist = hit.dist;
        matchSource = hit.place.source;
        matched++;
      } else {
        unmatched++;
      }
    } else {
      unmatched++;
    }

    photos.push({
      filename,
      place: placeName,
      lat,
      lon,
      source: 'takeout-sgurzheyev',
      matchDistMeters: matchDist,
      matchSource,
    });
  }

  // If very few matches at 120, we already tried 200 per-photo above.
  return { photos, matched, unmatched, jpgCount: files.length };
}

async function main() {
  const photosDir = firstExisting(PHOTOS_DIR_CANDIDATES);
  if (!photosDir) throw new Error('Photos dir not found');
  const metaDir = firstExisting(META_DIR_CANDIDATES);
  const placesPath = firstExisting(PLACES_CANDIDATES);
  const envPath = firstExisting(ENV_CANDIDATES);
  const outDir = firstExisting(OUT_DIR_CANDIDATES) || path.dirname(photosDir);
  if (!envPath) throw new Error('No .env found');

  const env = loadEnv(envPath);
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

  const placeCatalog = [];
  if (metaDir) {
    placeCatalog.push(
      ...loadGeoJsonPlaces(path.join(metaDir, 'Reviews.json'), 'reviews'),
      ...loadGeoJsonPlaces(path.join(metaDir, 'Saved Places.json'), 'saved')
    );
  }
  // Also try Acc1 places if they have coords
  placeCatalog.push(...loadAcc1Places(placesPath));

  // Dedupe by name+rounded coords
  const seen = new Set();
  const uniquePlaces = [];
  for (const p of placeCatalog) {
    const key = `${normalizeTitle(p.name)}|${p.lat.toFixed(5)}|${p.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePlaces.push(p);
  }
  console.log(`Place catalog: ${uniquePlaces.length} (metaDir=${metaDir || 'n/a'}, acc1=${placesPath || 'n/a'})`);
  console.log(`Photos dir: ${photosDir}`);

  const { photos, matched, unmatched, jpgCount } = buildManifest(photosDir, uniquePlaces);
  console.log(`JPGs: ${jpgCount}, matched: ${matched}, unmatched: ${unmatched}`);

  const manifest = { photos };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('Wrote', manifestPath);

  // Group by place display name
  const byPlace = new Map();
  for (const p of photos) {
    const place = p.place || UNMATCHED_TITLE;
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(p);
  }
  console.log(
    'Places:',
    [...byPlace.keys()].map((k) => `${k} (${byPlace.get(k).length})`).join('; ')
  );

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

  const uploaded = [];
  const errors = [];
  for (const [place, items] of byPlace) {
    const slug = slugify(place);
    items.sort((a, b) => String(a.filename).localeCompare(String(b.filename)));
    let nn = 1;
    for (const item of items) {
      const filePath = path.join(photosDir, item.filename);
      if (!fs.existsSync(filePath)) {
        errors.push({ filename: item.filename, error: 'missing file' });
        continue;
      }
      try {
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
        uploaded.push({
          place,
          filename: item.filename,
          key,
          url,
          bytes: body.length,
          lat: item.lat,
          lon: item.lon,
        });
        console.log(`R2 OK ${item.filename} -> ${key} (${body.length} bytes)`);
        nn++;
      } catch (e) {
        errors.push({ filename: item.filename, error: String(e.message || e) });
        console.error(`R2 FAIL ${item.filename}:`, e.message || e);
      }
    }
  }

  const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    realtime: { transport: ws },
  });
  const { data: gems, error: ge } = await supabase
    .from('memory_gems')
    .select('id,title,address,media_urls,metadata,user_id')
    .eq('user_id', USER_ID);
  if (ge) throw new Error(`fetch gems: ${ge.message}`);

  const gemNorms = (gems || []).map((g) => ({ gem: g, norm: normalizeTitle(g.title) }));

  const urlsByPlace = new Map();
  const firstGeoByPlace = new Map();
  for (const u of uploaded) {
    if (!urlsByPlace.has(u.place)) urlsByPlace.set(u.place, []);
    urlsByPlace.get(u.place).push(u.url);
    if (!firstGeoByPlace.has(u.place) && u.lat != null && u.lon != null) {
      firstGeoByPlace.set(u.place, { lat: u.lat, lon: u.lon });
    }
  }

  const updated = [];
  const created = [];
  const matchFailures = [];
  const nowIso = new Date().toISOString();

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

    const geo = firstGeoByPlace.get(place) || null;

    if (best && bestScore >= 65) {
      const merged = mergeMediaUrls(best.media_urls, r2Urls);
      const meta = {
        ...(best.metadata || {}),
        sgurzheyev_takeout_photos: true,
        attached_at: nowIso,
        sgurzheyev_match_score: bestScore,
        sgurzheyev_place_label: place,
        source: (best.metadata && best.metadata.source) || 'takeout-sgurzheyev',
      };
      if (geo) {
        meta.sgurzheyev_lat = geo.lat;
        meta.sgurzheyev_lon = geo.lon;
      }
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
          source: 'takeout-sgurzheyev',
          sgurzheyev_takeout_photos: true,
          attached_at: nowIso,
          note:
            place === UNMATCHED_TITLE
              ? 'Takeout Maps photos with no Acc1/Reviews/Saved place match within 200m'
              : 'Created from sgurzheyev Takeout Maps; no existing gem title match',
          ...(geo ? { lat: geo.lat, lon: geo.lon } : {}),
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
      console.log(
        `INSERT gem "${place}" (no match; best=${best?.title || 'n/a'} score=${bestScore})`
      );
    }
  }

  const sampleUrls = uploaded.slice(0, 5).map((u) => u.url);
  const headChecks = [];
  for (const url of sampleUrls.slice(0, 3)) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      headChecks.push({
        url,
        status: res.status,
        contentType: res.headers.get('content-type'),
      });
    } catch (e) {
      headChecks.push({ url, error: String(e.message || e) });
    }
  }

  const summary = {
    jpgFound: jpgCount,
    matchedToPlaces: matched,
    unmatchedCount: unmatched,
    placeCatalogSize: uniquePlaces.length,
    r2UploadCount: uploaded.length,
    places: [...urlsByPlace.keys()],
    gemsUpdated: updated.length,
    gemsCreated: created.length,
    matchFailuresBeforeInsert: matchFailures,
    updated,
    created,
    samplePublicUrls: sampleUrls,
    headChecks,
    errors,
    photosDir,
    ranAt: nowIso,
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  const outPath = path.join(outDir, '_upload_result.json');
  fs.writeFileSync(outPath, JSON.stringify({ ...summary, allUploaded: uploaded }, null, 2));
  console.log('Wrote', outPath);

  // Also mirror to /workspace root for easy CopyFromBox
  fs.writeFileSync(
    path.join(WORKSPACE, 'paranoic_sgurzheyev_maps_upload_result.json'),
    JSON.stringify({ ...summary, allUploaded: uploaded }, null, 2)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
