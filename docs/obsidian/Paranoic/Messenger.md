---
tags: [paranoic, messenger]
---

# Messenger

← [[paranoic]] · E2EE детали → [[Paranoic/Data Security]] · звонки → [[Paranoic/Calls]]

## Чаты

- Список + last previews (IndexedDB)
- Compose: текст / файл / голос (`ChatRecordButton`)
- Путь отправки: P2P encrypted → иначе `storeForward` → outbox
- Поиск: `ChatSearchPanel` (локально: All / Media / Links / Files / Voice)

## Контакты

- Локальная книга (IndexedDB / localforage) — не таблица Supabase
- Глобальный поиск: `profiles` по UUID, `@username`, magic link, имени
- Trust banner на новых контактах → trust / block

## Группы

- Create group UI + Realtime delivery
- `GroupManagementModal`: members, add/remove, leave, delete, rename
- RLS через security-definer helpers (фикс infinite recursion)

## Связи в графе

[[Paranoic/Architecture]] · [[Paranoic/Calls]] · [[Paranoic/Data Security]] · [[Paranoic/Family Map]]
