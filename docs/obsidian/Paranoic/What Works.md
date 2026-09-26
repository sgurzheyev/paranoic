---
tags: [paranoic, audit, works]
---

# What Works

← [[paranoic]] · полный статус → [[Paranoic/Audit 2026-09-12]] · roadmap → [[Paranoic/Feature Resolution]]

Проверено по коду 2026-09-12. «Works» = путь связан; не значит «без багов».

## Аккаунт ✅

- Email/password signup & sign-in, password recovery
- Username + profiles upsert
- Session persist
- Magic link / guest entry
- Google OAuth **только в API** — кнопки в UI нет → см. PARTIAL в аудите

## Мессенджер ✅

- Личные чаты, IndexedDB история + media
- E2EE online (DataChannel) + offline store-forward + outbox
- Typing indicator (`peerTyping`)
- Delivery status: sending → delivered → read (acks по P2P)
- Heart reaction на bubble
- Mute chat, clear history (локально)
- Поиск по локальным сообщениям
- Контакты: локальная книга + global `profiles` search
- Trust / block (cloud sync) + report
- Группы: create, Realtime, manage members, leave/delete/rename
- Chat header ··· menu

## Звонки

- UI ring / overlay / mic / cam / switch camera / guest call — ✅ UI
- FCM registration + token на profile — 🟡
- **Media 1:1 на main — 🔴** (ждём merge PR #1)
- Mesh group calls — 🟡 код есть

## Family ✅

- Mapbox GlobeLobby, memory gems + visibility, Zip Lift theme, Ghost / 24h toggles

## Прочее ✅

- Storage management, privacy policy, admin/moderation, Capacitor Android 1.2, Vercel

## Явно нет (проверено grep)

Reply/quote · edit message · delete-for-everyone · forward · FLAG_SECURE · sticker pack · multi-device
