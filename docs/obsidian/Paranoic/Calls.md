---
tags: [paranoic, calls, wip]
---

# Calls

← [[paranoic]] · чаты → [[Paranoic/Messenger]] · ICE/TURN → [[Paranoic/Stack]]

## 1:1 архитектура

Два слоя сигналинга:

1. **Room P2P** (`p2p.ts`) — `room:{roomId}` + DataChannel
2. **Call inbox** (`callSignaling.ts`) — `calls:{userId}` (`call_offer` / reject / cancel)
3. **DB** — `call_sessions` (ringing → accepted / cancelled / rejected / ended)

```
idle → calling → in-call     (outbound)
idle → ringing → in-call     (inbound)
```

UI: `CallOverlay` · `IncomingCallModal` · `GuestDirectCall`

## Group / mesh

- `groupCall.ts` + `GroupCallGrid`
- WebRTC mesh audio/video (свежий фича-коммит)
- Делать **после** стабилизации 1:1

## Исторические фиксы

Explicit Call only · нет звонка на Back · SDP/ICE после CALL_OFFER filters · mobile harden · self-call block · UI lock до конца media

## Статус (2026-09-12)

✅ **PR #1 смержен в `main`** (`584bf64` fix 1:1 media handshake).  
Дальше: deploy + ручной тест → TURN → group mesh.

Трекер: [[Paranoic/Risks Tasks]]
