/**
 * Upload Acc1 Google Maps contrib photos to Cloudflare R2 and attach to memory_gems.
 * Simpler than takeout: uses existing manifest.json with place labels.
 * Safe: no deletes, do NOT run insert-gems.mjs. Merge media_urls only.
 */
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const WORKSPACE = '/workspace';
const PHOTOS_DIR = '/home/box/Downloads/paranoic_acc1_contrib_photos';
const ENV_CANDIDATES = [
  path.join(WORKSPACE, 'paranoic.env'),
  path.join(process.env.HOME || '/home/box', 'paranoic/.env'),
];

const USER_ID = '7b047ce2-1c47-45d9-8391-1908f4ce1e82';
const KEY_PREFIX = 'memory-gems/acc1-contrib';
const UNMATCHED_TITLE = 'Acc1 Contrib (unmatched)';
const MATCH_THRESHOLD = 65;

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

function displayPlace(place) {
  const p = String(place || '').trim();
  if (!p || /^unknown$/i.test(p)) return UNMATCHED_TITLE;
  return p;
}

async function main() {
  const photosDir = PHOTOS_DIR;
  if (!fs.existsSync(photosDir)) throw new Error(`Photos dir not found: ${photosDir}`);
  const manifestPath = path.join(photosDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest.json not found: ${manifestPath}`);

  const envPath = firstExisting(ENV_CANDIDATES);
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

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const photos = Array.isArray(manifest.photos) ? manifest.photos : [];
  if (!photos.length) throw new Error('manifest.photos empty');

  // Group by display place
  const byPlace = new Map();
  let unmatchedPhotoCount = 0;
  for (const p of photos) {
    const place = displayPlace(p.place);
    if (place === UNMATCHED_TITLE) unmatchedPhotoCount++;
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(p);
  }
  console.log(`Photos: ${photos.length}, places: ${byPlace.size}, unmatched photos: ${unmatchedPhotoCount}`);
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
  console.log(`Existing gems for user: ${(gems || []).length}`);

  const urlsByPlace = new Map();
  for (const u of uploaded) {
    if (!urlsByPlace.has(u.place)) urlsByPlace.set(u.place, []);
    urlsByPlace.get(u.place).push(u.url);
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

    if (best && bestScore >= MATCH_THRESHOLD && place !== UNMATCHED_TITLE) {
      const merged = mergeMediaUrls(best.media_urls, r2Urls);
      const meta = {
        ...(best.metadata || {}),
        acc1_contrib_photos: true,
        acc1_contrib_attached_at: nowIso,
        acc1_contrib_match_score: bestScore,
        acc1_contrib_place_label: place,
        source: (best.metadata && best.metadata.source) || 'acc1-contrib',
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
        photoCount: r2Urls.length,
        mediaCount: merged.length,
        sample: merged[0],
      });
      console.log(
        `UPDATE gem "${best.title}" <- ${place} (score=${bestScore}) photos=${r2Urls.length} urls=${merged.length}`
      );
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
          source: 'acc1-contrib',
          acc1_contrib_photos: true,
          acc1_contrib_attached_at: nowIso,
          note:
            place === UNMATCHED_TITLE
              ? 'Acc1 Maps contrib photos with Unknown/empty place label'
              : 'Created from Acc1 Maps contrib; no existing gem title match ≥65',
          ...(bestScore > 0
            ? { prior_best_title: best?.title || null, prior_best_score: bestScore }
            : {}),
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
        photoCount: r2Urls.length,
        mediaCount: (ins.media_urls || []).length,
        sample: (ins.media_urls || [])[0],
        priorBest: best?.title || null,
        priorScore: bestScore,
      });
      console.log(
        `INSERT gem "${place}" (no match; best=${best?.title || 'n/a'} score=${bestScore}) photos=${r2Urls.length}`
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
    profile: manifest.profile || null,
    savedCount: manifest.saved_count || photos.length,
    jpgFound: photos.length,
    unmatchedPhotoCount,
    placeCount: urlsByPlace.size,
    places: [...urlsByPlace.entries()].map(([k, v]) => ({ place: k, photos: v.length })),
    r2UploadCount: uploaded.length,
    gemsUpdated: updated.length,
    gemsCreated: created.length,
    matchFailuresBeforeInsert: matchFailures,
    updated,
    created,
    samplePublicUrls: sampleUrls,
    headChecks,
    errors,
    photosDir,
    keyPrefix: KEY_PREFIX,
    userId: USER_ID,
    ranAt: nowIso,
  };
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));

  const outPath = path.join(photosDir, '_upload_result.json');
  fs.writeFileSync(outPath, JSON.stringify({ ...summary, allUploaded: uploaded }, null, 2));
  console.log('Wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
