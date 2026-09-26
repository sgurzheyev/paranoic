---
tags: [paranoic, risks, tasks]
---

# Risks & Tasks

← [[paranoic]] · звонки → [[Paranoic/Calls]] · аудит файл: `~/paranoic/APP_AUDIT.md`

## PRs

- [#1 call media](https://github.com/sgurzheyev/paranoic/pull/1) — merge first
- [#2 APP_AUDIT refresh](https://github.com/sgurzheyev/paranoic/pull/2) — docs only

## Активно

- [ ] **P0** Починить соединение 1:1 ([[Paranoic/Calls]])
- [ ] **P1** Group / mesh calls
- [ ] Обновить APP_AUDIT под текущий `main` (~46 коммитов после 2026-08-23)

## HIGH (PR #2)

- [ ] 1:1 media (PR #1)
- [ ] Private TURN (`VITE_TURN_*`)
- [ ] FCM sender + `google-services.json`
- [ ] Family gem RLS (family ≠ public)
- [ ] Не маркетировать deterministic AES как Signal E2EE
- [ ] Block enforce on send in open chat
- [ ] Mute → gate notifications

## Из аудита (medium)

- [ ] Avatar в ProfileHome сначала только локально
- [ ] Hardcoded RU на карте (i18n)
- [ ] SQL миграции вручную — чеклист деплоя
- [ ] Global search ↔ RLS на `profiles`
- [ ] Admin delete user не каскадит `auth.users`

## Low / info

- Google OAuth не в UI
- Нет фидбека при отказе notification permission
- `call_sessions` ошибки только warn
- Screen-share не отрисован в CallOverlay

## Связи

[[Paranoic/Architecture]] · [[Paranoic/Messenger]] · [[Paranoic/Data Security]] · [[Paranoic/Family Map]] · [[Paranoic/Stack]]
