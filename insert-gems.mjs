import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://utrodydoueclytbymkbr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DOWNLOADS = path.join(os.homedir(), 'Downloads');

function loadJson(name) {
  const p = path.join(DOWNLOADS, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : [];
}

async function geocode(query) {
  const clean = query.replace(/[^\w\s\u0400-\u04FF,.-]/gi, ' ').trim();
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean)}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'ParanoicApp/1.0 (contact@paranoic.men)' } });
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch {}
  return null;
}

async function run() {
  console.log('🚀 Объединение локаций Аккаунта 1 и Аккаунта 2...\n');

  const acc1 = loadJson('google_maps_places_acc1.json');
  const acc2 = loadJson('google_maps_places_full.json');

  const map = new Map();

  // Добавляем точки из Аккаунта 1 (с фото)
  acc1.forEach(p => {
    map.set(p.name.toLowerCase().trim(), {
      name: p.name,
      address: p.address || '',
      photos: p.photos || [],
      reviews: []
    });
  });

  // Добавляем/объединяем точки из Аккаунта 2 (с отзывами)
  acc2.forEach(p => {
    const k = p.name.toLowerCase().trim();
    if (!map.has(k)) {
      map.set(k, { name: p.name, address: p.address || '', photos: [], reviews: [p] });
    } else {
      const item = map.get(k);
      if (!item.address && p.address) item.address = p.address;
      item.reviews.push(p);
    }
  });

  const allPlaces = Array.from(map.values());
  console.log(`💎 Всего уникальных точек с двух аккаунтов: ${allPlaces.length}\n`);

  // Очищаем базу перед заливкой полного архива
  await supabase.from('memory_gems').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  let successCount = 0;

  for (let i = 0; i < allPlaces.length; i++) {
    const item = allPlaces[i];
    const query = item.address.length > 6 ? item.address : item.name;

    console.log(`[${i + 1}/${allPlaces.length}] Геокодинг: "${item.name}"...`);

    let coords = await geocode(query);
    if (!coords && item.address && item.name) coords = await geocode(item.name);

    const row = {
      title: item.name,
      address: item.address,
      media_urls: item.photos,
      metadata: {
        reviews: item.reviews,
        lat: coords?.lat || null,
        lng: coords?.lng || null
      }
    };

    const { error } = await supabase.from('memory_gems').insert([row]);
    if (!error) {
      successCount++;
      if (coords) console.log(`  ✅ [${coords.lat}, ${coords.lng}]`);
      else console.log(`  ⚠️ Без точных координат`);
    } else {
      console.error(`  ❌ Ошибка:`, error.message);
    }

    await new Promise(r => setTimeout(r, 1050));
  }

  console.log(`\n🎉 ГОТОВО! Полный архив воспоминаний (${successCount} мест) нанесен на карту в Supabase.`);
}

run();