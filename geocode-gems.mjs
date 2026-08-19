import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Подгружаем переменные из .env
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://utrodydoueclytbymkbr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Ошибка: не найдены ключи Supabase в .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ParanoicMapApp/1.0 (contact@paranoic.men)' }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
  } catch (err) {
    console.error(`Ошибка запроса координат для "${query}":`, err.message);
  }
  return null;
}

async function run() {
  console.log('🔍 Загрузка Memory GEMs из Supabase...');
  
  const { data: gems, error } = await supabase
    .from('memory_gems')
    .select('id, title, address, metadata');

  if (error) {
    console.error('❌ Ошибка загрузки из Supabase:', error.message);
    return;
  }

  console.log(`💎 Найдено капсул памяти: ${gems.length}`);

  let updatedCount = 0;

  for (let i = 0; i < gems.length; i++) {
    const gem = gems[i];
    
    // Если координаты уже есть — пропускаем
    if (gem.metadata?.lat && gem.metadata?.lng) {
      console.log(`⏩ [${i + 1}/${gems.length}] Уже есть координаты: ${gem.title}`);
      continue;
    }

    // Ищем по адресу, если пустой — по названию заведения
    const query = (gem.address && gem.address.trim().length > 3) ? gem.address : gem.title;
    console.log(`📍 [${i + 1}/${gems.length}] Геокодинг: ${gem.title} -> "${query}"...`);

    let coords = await geocode(query);

    // Фоллбек: если по полному адресу не нашло, пробуем чисто по названию города/места
    if (!coords && gem.address && gem.title) {
      coords = await geocode(gem.title);
    }

    if (coords) {
      const updatedMetadata = {
        ...(gem.metadata || {}),
        lat: coords.lat,
        lng: coords.lng
      };

      const { error: updateErr } = await supabase
        .from('memory_gems')
        .update({ metadata: updatedMetadata })
        .eq('id', gem.id);

      if (!updateErr) {
        updatedCount++;
        console.log(`  ✅ Сохранены координаты: [${coords.lat}, ${coords.lng}]`);
      } else {
        console.error(`  ❌ Ошибка записи в Supabase:`, updateErr.message);
      }
    } else {
      console.warn(`  ⚠️ Не удалось определить точку на карте для: ${gem.title}`);
    }

    // Лимит 1 сек для Nominatim
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`\n🎉 Готово! Проставлены координаты для ${updatedCount} капсул.`);
}

run();