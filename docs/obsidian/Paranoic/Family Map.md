---
tags: [paranoic, map, family]
---

# Family Map

← [[paranoic]] · данные → [[Paranoic/Data Security]] · тема → [[Paranoic/Architecture]]

## GlobeLobby

Режим **Family**: Mapbox карта, слои, targeting / move-pin, dock controls.

## Memory Gems

Единая таблица `memory_gems` (map_gems смержены).

| Visibility | Кто видит |
|------------|-----------|
| `private` | только автор |
| `family` | семейный круг |
| `public` | публично |

UI: `MemoryGemComposer` · `MemoryGemDrawer` · `MemoryGemPopup`  
Медиа → Cloudflare R2 · фильтр `canViewGem()`

## Тема на карте

**Zip Lift** (`themeSpectrum` 0–100) морфит CSS vars + Mapbox `lightPreset` в реальном времени.

## Погода и RUSH

Две круглые кнопки в правом dock, под зумом. Выключены, пока пользователь сам не нажмёт.

- **Погода** — Open-Meteo по центру карты. Координаты округляются до 0.1°, ответ кэшируется 12 минут. На HTTP 429 пауза от 15 минут. Дождь и пыльная буря рисуются поверх глобуса и слегка меняют туман.
- **RUSH** — цикл корабли → самолёты → выкл. Корабли идут через `/api/ais-nearby` (ключ `AISSTREAM_API_KEY` только на Vercel, не в клиенте). Самолёты — `/api/opensky-states` и `/api/adsb-nearby`, ключ не нужен. Опрос останавливается, когда слой выключен, карта скрыта или приложение в фоне.

`?overlayDemo=1` рисует подписанные DEMO-метки без живых запросов (для проверки экрана, не для пользователей).
