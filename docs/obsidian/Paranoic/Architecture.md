---
tags: [paranoic, architecture]
---

# Architecture

← [[paranoic]]

## Режимы

| Режим | Entry | Суть |
|-------|-------|------|
| **Paranoic** | после auth, `setAppMode('paranoic')` | мессенджер |
| **Family** | Settings → Map / shortcuts | карта `GlobeLobby` |

Назад с карты → Contacts tab.

## Shell

- `App.tsx` — корневой shell, call handlers, ошибки
- `LiquidNavigationBar` — Chats · Contacts · Settings · Profile  
  Скрыт во время чата / звонка / guest-call / incoming ring

## Модули (граф)

- [[Paranoic/Messenger]] — чаты и группы
- [[Paranoic/Calls]] — WebRTC
- [[Paranoic/Family Map]] — gems на карте
- [[Paranoic/Data Security]] — ключи и sync
- [[Paranoic/Stack]] — чем собрано

## Ключевые UI-файлы

`AuthScreen` · `ChatHeader` · `ContactsSearchPanel` · `CreateGroupModal` · `GroupManagementModal` · `CallOverlay` · `IncomingCallModal` · `GlobeLobby` · `ProfileModal` · `ZipLiftSlider` · `AdminDashboard` · `StorageManagementModal` · `AiBodyguardChat`
