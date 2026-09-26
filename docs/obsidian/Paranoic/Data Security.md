---
tags: [paranoic, security, data]
---

# Data Security

← [[paranoic]] · используется в [[Paranoic/Messenger]] · [[Paranoic/Calls]] · [[Paranoic/Family Map]]

## E2EE

1. `deriveKeyFromRoom(personalInboxRoom(peerId))` → Web Crypto
2. Online — ciphertext по P2P DataChannel
3. Offline — `messages` + Storage (`offline-transfers`); sync ~45 с и на `online`

## Локально

| Store | Зачем |
|-------|-------|
| `paranoic-settings-v1` | тема, язык, settings |
| `paranoic-identity-v1` | identity |
| `paranoic-session-v1` | login session |
| trusted/blocked ids | кэш peer relations |
| IndexedDB messages/media/contacts | история и книга |

## Cloud

- `user_peer_relations` — trust/block sync (`trustSync.ts`)
- `profiles` + presence heartbeat (~15 с)
- RLS: groups helpers, harden policies, auth.uid() = identity.id
- Ручные SQL: `memory_gems_unified`, `user_peer_relations`, `groups`, …

## Compliance

Block/report · storage management modal · privacy policy page · admin UGC moderation
