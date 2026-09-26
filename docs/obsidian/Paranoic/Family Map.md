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
