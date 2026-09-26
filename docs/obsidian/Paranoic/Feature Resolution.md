---
tags: [paranoic, roadmap, features]
aliases: [Feature Resolution, Фичи Paranoic]
---

# Feature Resolution

← [[paranoic]] · статус кода → [[Paranoic/Audit 2026-09-12]] · что уже живое → [[Paranoic/What Works]] · звонки → [[Paranoic/Calls]]

Обновлено после code-verified аудита: typing + delivered/read **уже есть**; в P1 убраны как «с нуля».

Резолюция: **сначала стабильность ядра мессенджера**, потом parity с известными приложениями, потом уникальные фичи Paranoic (Family/gems). Не копировать всё из Telegram/WhatsApp — выбрать то, что усиливает privacy + звонки + карту.

Бенчмарки: **WhatsApp · Telegram · Signal · iMessage** (точечно Discord для групп/звонков).

---

## Принцип приоритетов

| P | Смысл | Правило |
|---|--------|---------|
| **P0** | Без этого продукт «ломается» в голове юзера | Звонки соединяются, сообщения доходят, аккаунт работает |
| **P1** | Ожидание от любого современного мессенджера | Без этого сравнивают с WA/TG и уходят |
| **P2** | Дифференциатор Paranoic | Family map, gems, privacy UX |
| **P3** | Позже / nice-to-have | Не блокирует рост |

---

## Резолюция фич (решение)

### P0 — чинить сейчас (до новых фич)

1. **1:1 call media connection** — merge + проверить PR #1; без стабильного «трубка взята → слышно» остальное бессмысленно.  
2. **Group/mesh calls** — довести после 1:1 (уже есть код, нужна надёжность).  
3. **E2EE + offline delivery** — убедиться, что store-and-forward и outbox не теряют сообщения на flaky mobile.

*Решение: никакого большого feature-спринта, пока P0 зелёный на 2 устройствах (web + Android).*

### P1 — parity с известными мессенджерами (обязательный набор)

| Фича | Есть у | У Paranoic сейчас | Решение |
|------|--------|-------------------|---------|
| Надёжные голосовые/видео 1:1 | все | PARTIAL/BROKEN на main | **Сделать** (P0) |
| Групповые звонки | WA, TG, Signal | код mesh есть | **Сделать** после 1:1 |
| Групповые чаты + админ участников | все | WORKS (базово) | Углубить: роли admin/member, kick audit |
| Read receipts / delivered | WA, Signal, iMessage | ✅ delivered/read по P2P | Privacy toggle «hide read»; добить UI в группах |
| Typing indicator | все | ✅ уже есть | Держать; проверить в группах |
| Message reply / quote | все | ? | **Сделать** |
| Forward message | WA, TG | ? | **Сделать** (с E2EE-ограничениями) |
| Delete for me / delete for everyone | WA, Signal | частично? | **Сделать** оба режима + таймер как WA |
| Edit message | TG, Signal | ? | **Сделать** (с пометкой edited) |
| Voice messages polished | WA, TG, Signal | есть record button | **Улучшить** waveform, lock-to-record, preview |
| Push когда приложение убито | все | FCM optional | **Сделать** обязательным для Android calls+msgs |
| Block + report | WA, Signal (Play) | WORKS | Держать; не трогать без нужды |
| Link previews | TG, WA, iMessage | ? | P2 (privacy: opt-in) |
| Multi-device sync | Signal, TG, WA linked | слабо / один профиль | **P2** — важное, но после P1 chat UX |
| Disappearing messages | Signal, WA | 24h deletion toggle есть (профиль) | **Расширить** per-chat timers 1m–7d |
| Username / deep link | TG, Signal | magic link + username | WORKS — оставить |
| Stickers / reactions rich | WA, TG, iMessage | double-tap heart only | **Reactions набор** (P1 лёгкий), стикеры P3 |
| Stories / channels / bots | WA, TG | нет | **Не делать** сейчас (размывает фокус) |
| Secret chat separate mode | TG | весь чат E2EE | Не нужно дублировать |
| Sealed sender / metadata privacy | Signal | нет | **P2** исследование |
| Screen security (no screenshot) | Signal, WA | ? | **Сделать** на Android flag (P1) |
| Google / Apple sign-in | многие | OAuth в коде, не в UI | **Подключить UI** (P1) после стабильных звонков |

### P2 — дифференциатор Paranoic (делать осознанно)

| Фича | Решение |
|------|---------|
| Family map + memory gems | **Усилить** — это moat; UX gems, sharing, moderation |
| Ghost Mode / Zip Lift theme | Полировка, не новые режимы |
| AI Bodyguard | Оставить experimental; не в core onboarding |
| AR Footprints | P3 / park |
| Guest call via magic link | Уникально — **дожать** вместе с call fix |
| Local-first address book | Сохранить; добавить backup/export encrypted |

### P3 — позже или отказ

- Каналы / супергруппы уровня Telegram  
- Stories / Status  
- Mini-apps / платежи  
- Desktop Electron (сначала PWA + Android)  
- Полный multi-account  

---

## Рекомендуемый порядок релизов

### R1 — «Calls work»
- Merge PR #1, ручной тест 1:1 web↔Android, Android↔Android  
- Smoke group call 3 участника  
- FCM wake на входящий звонок  

### R2 — «Chat feels modern»
- Reply, edit, delete-for-everyone  
- Delivered + optional read receipts  
- Typing  
- Reactions set (не только ❤)  
- Screen secure flag  

### R3 — «Family & trust»
- Gems UX + visibility понятны  
- Disappearing per-chat  
- Multi-device или хотя бы session list + remote logout  
- Google OAuth в AuthScreen  

### R4 — «Hardening»
- Обновлённый APP_AUDIT  
- RLS/SQL checklist автоматом  
- Sealed-sender research / metadata minimization  

---

## Что НЕ копировать слепо

1. **Telegram-channels / bots** — другая модель доверия, раздувает бэкенд.  
2. **WhatsApp Business API** — не ваш рынок.  
3. **Discord roles/permissions tree** — overkill для privacy messenger.  
4. **iMessage effects** — шум, не privacy.

Paranoic выигрывает как **Signal-like E2EE + звонки + личная карта Family**, не как клон TG.

---

## Связанные заметки

- [[Paranoic/What Works]]  
- [[Paranoic/Audit 2026-09-12]]  
- [[Paranoic/Risks Tasks]]  
- [[Paranoic/Calls]]  
- [[Paranoic/Messenger]]  
- [[Paranoic/Family Map]]
