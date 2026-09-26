---
tags: [paranoic, stack]
---

# Stack

← [[paranoic]] · связано с [[Paranoic/Architecture]]

| Слой | Технологии |
|------|------------|
| UI | React 19, TypeScript, Vite 8, Tailwind 4 |
| Mobile | Capacitor 8 (Android), Push Notifications |
| Backend | Supabase Auth + Postgres + Realtime + Storage |
| Media | Cloudflare R2 (AWS S3 SDK) |
| Maps | Mapbox GL |
| Calls | WebRTC + STUN/TURN → [[Paranoic/Calls]] |
| Deploy | Vercel (SPA + APK headers) |
| Lint | Oxlint |

**Scripts:** `dev` · `build` (`tsc -b && vite build`) · `lint` · `preview`  
**appId:** `men.paranoic.app`
