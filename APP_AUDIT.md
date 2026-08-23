# Paranoic Application Audit

Functional and UI audit of the Paranoic encrypted messenger (React + Vite).  
Covers every major screen, interactive control, backend target, and error behavior as implemented in the current codebase.

**Audit date:** 2026-08-23  
**Branch audited:** `main` (post unified gems, Zip Lift ProfileModal, cloud trust/block, contacts global search)

---

## Recent Architecture Updates

| Area | Summary |
|------|---------|
| **Unified gems** | `map_gems` merged into `memory_gems`; `visibility` enum (`private` \| `family` \| `public`) replaces legacy `is_private` checkboxes. Composer and drawer use a visibility picker; map fetch filters via `canViewGem()`. |
| **ProfileModal & Zip Lift** | Fully localized via `t()`; Ukrainian (`ua`) in top-10 languages. Horizontal **Zip Lift** spectrum slider (`themeSpectrum` 0–100) morphs CSS vars + Mapbox `lightPreset` in real time. Compact round icon toggles for Ghost Mode and 24h deletion. UA palette stop toggles `theme-ua` easter egg. |
| **Cloud trust/block** | `user_peer_relations` Supabase table syncs trusted/blocked peer IDs across devices; `trustSync.ts` merges cloud ↔ localStorage cache on login. |
| **Contacts global search** | `ContactsSearchPanel` in Contacts tab — instant local filter + debounced Supabase `profiles` lookup by UUID, `@username`, magic link, or name. |

---

## Table of Contents

0. [Recent Architecture Updates](#recent-architecture-updates)
1. [Application Shell & Navigation](#1-application-shell--navigation)
2. [Auth Screen](#2-auth-screen)
3. [Map & GlobeLobby](#3-map--globelobby)
4. [Chat & Messenger](#4-chat--messenger)
5. [P2P Video Calls](#5-p2p-video-calls)
6. [Settings & Profile](#6-settings--profile)
7. [Admin Dashboard](#7-admin-dashboard)
8. [Cross-Cutting Data Stores](#8-cross-cutting-data-stores)
9. [Known Gaps & Risks](#9-known-gaps--risks)

---

## 1. Application Shell & Navigation

### Modes

| Mode | Entry | Exit |
|------|-------|------|
| **Paranoic** (messenger) | Default after auth; `setAppMode('paranoic')` | — |
| **Family** (map) | Settings → **Map**; Profile shortcuts; map CTAs | GlobeLobby **Back** → Contacts tab |

### Bottom navigation (`LiquidNavigationBar.tsx`)

Hidden during active chat, call UI, guest direct-call screen, or incoming ring.

| Tab (i18n) | Action | Backend | Error handling |
|------------|--------|---------|----------------|
| **Chats** | `goMainTab('chats')` — shows chat list + search | None (local UI) | — |
| **Contacts** | `goMainTab('contacts')` — address book + global search | Local contacts (IndexedDB); global lookup → `profiles` | Search errors → empty global results; add/chat via existing connect flow |
| **Settings** | `goMainTab('settings')` | None | — |
| **Profile** | `goMainTab('profile')` | None | — |

`goMainTab` also switches from Family mode back to Paranoic when a tab is selected.

### Global error surface

- **`setError(...)`** in `App.tsx` — top-level banner/toast for bans, blocks, media failures, send failures.
- **Family call alerts** — `callAlert` state (non-toast) when in Family mode.
- **Inline alerts** — Auth, Profile, gem composer/drawer, trust banner context.

---

## 2. Auth Screen

**File:** `src/AuthScreen.tsx`  
**Default mode:** Sign up  
**Backend:** Supabase Auth + `profiles` table via `authCredentials.ts`

### Inputs

| Field | UI label (i18n) | Validation (client) | Notes |
|-------|-----------------|---------------------|-------|
| Nickname | `auth.nickname` | Sign-up only. Validated in `signUpWithEmailPassword` via `validateUsername()` (`identity.ts`) and `isUsernameAvailable()` → `profiles` query | Not validated in AuthScreen UI itself |
| Email | `auth.email` | `EMAIL_RE` in `authCredentials.ts` | Enter key submits |
| Password | `auth.password` | Min 4 chars in auth layer | `autoComplete` switches by mode |

### Buttons & toggles

| Control | Action | Backend / API | Error handling |
|---------|--------|---------------|----------------|
| **GO PARANOIC** (`auth.go`) | `submit()` | **Sign in:** `supabase.auth.signInWithPassword` → `finishAuthenticatedSession()` → `profiles` upsert → `onAuthenticated()` → `forcePersistSession()` | `result.ok === false` → `setError(result.message)`; uncaught → `setError(e.message \|\| auth.failed)`; shows `…` while busy |
| **Sign in / Sign up toggle** (`auth.haveAccount` / `auth.noAccount`) | `toggleMode()` | None | Clears error; flips mode |
| *(not wired)* Google OAuth | — | `signInWithGoogleOAuth()` exists in `authCredentials.ts` but is **not exposed** in AuthScreen | — |

### Sign-up flow details

1. `validateUsername(nickname)` — pattern `^[a-z][a-z0-9_]{2,23}$`
2. `isUsernameAvailable()` — `profiles` SELECT (case-insensitive username)
3. `supabase.auth.signUp({ email, password, options: { data: { username } } })`
4. On immediate session: `profiles` upsert, `finishAuthenticatedSession()`
5. Email confirmation pending → `setError(auth.confirmEmail)`, password cleared

### Sign-in error mapping (`mapAuthError`)

| Condition | User message (RU in code) |
|-----------|---------------------------|
| Supabase not configured | Config error string |
| Invalid email | "Введите корректный email" |
| Short password | "Пароль: минимум 4 символа" |
| Email not confirmed | Confirmation prompt |
| Wrong credentials | "Неверный email или пароль" |
| Email already registered (sign-up) | "Этот email уже зарегистрирован" |
| Username taken | "Этот никнейм уже занят…" |

---

## 3. Map & GlobeLobby

**File:** `src/GlobeLobby.tsx`  
**Map engine:** Mapbox GL JS (`src/lib/mapbox.ts`)  
**Token:** `VITE_MAPBOX_TOKEN` — missing → full-screen overlay + Back

### Mapbox integration

| Aspect | Implementation | Error handling |
|--------|----------------|----------------|
| Map init | `mapboxgl.Map`, standard style, pitch 42°, zoom 2.1; initial + live theme from Zip Lift spectrum | Creation failure → `setTokenMissing(true)` |
| Map style | `themeSpectrum` → `applyThemeSpectrum()` sets CSS vars; `GlobeLobby` listens for `paranoic-theme-spectrum` and calls `applyMapThemePreset()` | Missing token → overlay; style busy → `console.warn` |
| Controls | Mapbox `NavigationControl` (pitch/compass); custom zoom dock | `map.on('error')` → `console.error` |
| Resize | `ResizeObserver` + window resize | — |
| Boot splash | `sessionStorage paranoic-map-booted` | — |

### Data sources

| Data | Table / service | Used for |
|------|-----------------|----------|
| Memory gems (unified) | `memory_gems` — single read/write path (`fetchMemoryGems`, `createMemoryGem`) | Pin layer, composer, drawer, AI context |
| Gem visibility | Column `visibility` enum: `private` \| `family` \| `public` | Client-side filter via `canViewGem(viewerId, contactIds)` |
| Gem media | Cloudflare R2 (`map-gems/` via `uploadGemMedia`) | Photo/video URLs |
| Gem social | `gem_likes`, `gem_comments` | Likes/comments in drawer |
| Contacts on map | Local `loadContacts()` + presence | Filtering gems (`family`) + AI context |
| Presence / GPS | `profiles` + Realtime presence | Avatar markers |
| Map tiles | Mapbox API | Rendering only |

> **Unified gems:** `createMapGem()` delegates to `createMemoryGem()` — all new pins INSERT into `memory_gems`. Legacy `map_gems` rows were migrated via `supabase/memory_gems_unified.sql`. The old `is_private` boolean is superseded by `visibility` (backfilled: `true` → `private`, else `public`). Composer default visibility is `family`.

### Gem visibility rules (`mapGems.ts`)

| Value | Who can see on map |
|-------|-------------------|
| `private` | Owner only |
| `family` | Owner + users in viewer's local contacts list |
| `public` | Everyone |

`fetchMemoryGems({ viewerId, contactIds })` applies `canViewGem()` after SELECT.

### Layer toggles (Layers menu)

| Toggle (i18n) | Action | Backend | Error handling |
|---------------|--------|---------|----------------|
| **Contacts** | `setShowContacts` — filters visible people to contacts + self | Local React state | None |
| **Pin** | `setShowGems` — toggles gem Mapbox layers + HTML markers | Re-fetches `memory_gems` when enabled | Fetch fail → `console.warn`, `[]` |
| **Ghost Mode** | `onGhostModeChange(checked)` → parent `saveSettings({ ghostMode })` | `localStorage`; parent skips GPS, sends Antarctica coords to presence/`profiles` | Geo denied → alert in App |

### Side dock buttons

| Button | Action | Backend | Error handling |
|--------|--------|---------|----------------|
| **Layers** | Toggle layers dropdown | None | Closes on outside click / Escape |
| **Zoom In (+)** | `nudgeZoom(+1.2)`, max ~17.5 | None | Disabled at max |
| **My Location** | `flyToMyLocation()` | None | No-op if no self marker |
| **Zoom Out (−)** | `nudgeZoom(-1.2)`, min ~1.4 | None | Disabled at min |
| **Memory Pin** (camera) | Enter targeting mode (crosshair) | None | Disabled when `banned` |
| **AR Footprints** | Lazy-load `ArFootprints.tsx` overlay | None | `SoftFeatureBoundary` fallback |
| **AI Secretary** | Open `AiBodyguardChat` with live map context | Local reads (gems, contacts, P2P) | Context build swallows contact errors |

### Map interactions (non-button)

| Interaction | Action | Backend | Error handling |
|-------------|--------|---------|----------------|
| Long-press / right-click | Open `MemoryGemComposer` at point | → `createMapGem` + R2 upload | Composer `alert()` + inline error |
| Avatar marker tap | `onChatUser(person)` (self → fly only) | Parent → P2P session | Banned → App error toast |
| Avatar marker double-tap | `onCallUser(person)` | Parent → P2P call | Media blocked / banned → App error |
| Gem layer / HTML marker click | Open `MemoryGemDrawer`, fly to gem | None | Layer attach → `console.warn` |
| Contact strip avatar | `flyToPerson(c)` — camera only | None | — |

### Targeting & move-pin modes

| Button | Action | Backend | Error handling |
|--------|--------|---------|----------------|
| **Поставить метку здесь** | `confirmTargetDrop()` → composer at map center | `createMapGem` + R2 | Composer errors |
| **Отмена** (targeting) | `exitTargetingMode()` | None | — |
| **Сохранить новую позицию** | `confirmMovePin()` → `moveOwnedGem()` | UPDATE `memory_gems` lat/lng | Toast via `setGemNotice(error.message)` |
| **Отмена** (move) | `exitMovePinMode()` | None | — |

### Header & selected-person card

| Button | Action | Backend | Error handling |
|--------|--------|---------|----------------|
| **Back** | `onBack()` → Contacts tab | None | — |
| **Call alert** (PhoneOff) | Reveal call failure toast | None | — |
| **Admin Panel** | `onOpenAdmin()` | Admin dashboard | Admin role only |
| **Написать** | `onChatUser(selected)` | P2P + `profiles` validation | Banned check in App |
| **Позвонить** | `onCallUser(selected)` | P2P WebRTC | `callMediaBlocked` styling |
| **X** (dismiss card) | `setSelected(null)` | None | — |

### Memory Gem Composer (`MemoryGemComposer.tsx`)

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Photo / Video / Text** | Pick media type + file picker | — | File > 15 MB → inline error |
| **Visibility picker** (i18n) | `private` / `family` / `public` — replaces legacy privacy checkboxes | Saved on gem row as `visibility` | Default: `family` |
| **Save capsule** | `uploadGemMedia` → `createMapGem` → `createMemoryGem` | R2 + INSERT `memory_gems` | `alert(detail)` + inline error |
| **Premium paywall OK** | Close paywall | `isFreeGemLimitReached()` checks own gem count + `profiles.is_premium` | — |
| **Close / backdrop** | `onClose()` | None | Disabled while busy |

### Memory Gem Drawer (`MemoryGemDrawer.tsx`)

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Close (X)** | `onClose()` | None | — |
| **Edit** | Enter edit form | — | Owner only |
| **Move pin** | `onMovePin(gem)` → move mode | — | Owner only |
| **Delete** | `deleteOwnedGem(gem)` | R2 delete + DELETE `memory_gems` | `window.confirm`; inline `deleteError` |
| **Visibility badge / edit** | Shows `private` / `family` / `public`; editable on save | UPDATE `memory_gems.visibility` | Owner only |
| **Like** | `toggleGemLike(gemId)` | INSERT/DELETE `gem_likes` | Optimistic revert + `socialError` |
| **Comment send** | `addGemComment(gemId, text)` | INSERT `gem_comments` | Rollback + `socialError` |
| **Save edit** | `updateOwnedGem` + optional R2 upload | UPDATE `memory_gems` + R2 | `editError` inline |
| **Prev/Next** | Cycle gems | None | Disabled while editing/deleting |

---

## 4. Chat & Messenger

**Primary file:** `src/App.tsx`  
**Local storage:** IndexedDB via `storage.ts` (messages, media blobs)  
**Offline relay:** Supabase `messages` table + `offline-transfers` bucket via `storeForward.ts`

### E2EE model

- Key derivation: `deriveKeyFromRoom(personalInboxRoom(peerId))` → Web Crypto `CryptoKey`
- Live path: encrypted packets over P2P DataChannel
- Offline path: ciphertext stored in Supabase; recipient decrypts on sync
- UI hint: Profile tab shows E2EE status when `keyString` is set

### Chat list (Chats tab)

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **ContactListRow** (main) | `quickChatContact(c)` → `connectToLocalContact` → `openPeerSession` | `validateContactForCall` → `profiles`; local contacts book | Banned/blocked/self → `setError` |
| **ContactListRow** (call icon) | `quickCallContact(c)` | Same + P2P WebRTC | Media blocked → error toast |
| **Active session card — Call** | `startCall()` | P2P + `call_sessions` | Media/ban errors |
| **Active session card — Open chat** | `setScreen('chat')` | None | — |
| **Disconnect** | `disconnect()` — tears down P2P | None | — |
| Chat ordering | `chatsOrdered` by `lastPreviews` | IndexedDB `messages` via `loadLastMessagePreviews` | Swallowed in storage |

**Contacts book:** IndexedDB via `localforage` (`contacts.ts`) — not a Supabase table.

### Contacts tab (`ContactsSearchPanel.tsx`)

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| Search input | Debounced 180 ms; instant local filter in parent | Local contacts filter by name / id / username | — |
| Clear (X) | Reset query + global results | None | — |
| **Global results** | Shown when query matches UUID, `@username`, magic link (`?u=`), or ≥2 chars | `searchProfilesGlobally()` → `profiles` (`id.eq`, `username.ilike`, `name.ilike`) | Fetch fail → `console.warn`, empty list |
| **Add** | `upsertContact({ source: 'manual' })` → refresh list | IndexedDB contacts book | Disabled while adding |
| **Chat** | `connectToUser(profile.id, profile.name, { openChat: true })` | `validateContactForCall` → `profiles` | Ban/block/self → `setError` |

Global hits exclude users already in the local address book and banned profiles (`is_banned`).

Styling reuses `.chat-search-*` glass field (theme-aware via Zip Lift CSS vars).

### Chat Search (`ChatSearchPanel.tsx`)

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| Search input | Debounced 120 ms → `searchLocalChatMessages` | IndexedDB only | Empty → `searchEmpty` message |
| Filter tabs (All/Media/Links/Files/Voice) | `setFilter` → re-search | IndexedDB classification | — |
| Clear (X) | Reset query + filter | None | — |
| Contact hit | `onOpenPeer(c.id, c.name)` | Parent validates via `profiles` | — |
| Message hit | `onOpenPeer(hit.peerId, peer)` | Same | Thumbnail from IndexedDB — silent fail if missing |

### Direct chat — compose area

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Send** (form submit) | `sendText()` | 1) P2P encrypted, 2) `uploadPendingText` → INSERT `messages`, 3) `enqueueOutbox` (IndexedDB) | Catch → SAF retry → outbox fallback; `setError` on total failure |
| **Attach** (paperclip) | File picker → `sendMedia(file)` | P2P encrypted file, or `uploadPendingMedia` → Storage + INSERT `messages` | Progress UI; offline without Supabase → error |
| **ChatRecordButton** | Voice/circle recording → `sendMedia` | Same as attach | `onError` → `setError` |
| Message placeholder | Text input | — | — |

### Incoming / file messages

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Accept file** | `acceptFile(id)` | IndexedDB `media` store | `setError('Файл больше недоступен')` |
| **Retry file** | `retryFileTransfer(id)` | Re-send via P2P | Disabled if not connected |
| Bubble double-tap | Heart reaction via P2P | Not persisted server-side | — |
| Download link | Browser download from blob URL | Local IndexedDB | — |

### Offline message sync (`storeForward.ts`)

| Function | Action | Table / bucket | Error handling |
|----------|--------|----------------|----------------|
| `uploadPendingText` | INSERT encrypted text row | `messages` (`pending_delivery=true`) | RLS hints in thrown Error; duplicate → UPDATE |
| `uploadPendingMedia` | Upload ciphertext + INSERT row | `offline-transfers` bucket, path `{auth.uid()}/{toUserId}/{id}.bin` | Rollback Storage on INSERT failure |
| `syncPendingDeliveries` | SELECT pending for recipient, decrypt, purge | `messages` + Storage | Per-row `console.warn`; fetch error → `{0,0}` |
| `purgePendingDelivery` | DELETE Storage object + row | Both | `console.warn` on failure |

Sync runs every 45 s and on `online` event.

### Trust banner (new contact)

Shown when: chat open + active peer + **not trusted** + at least one incoming message.

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Trust** | `handleTrustPeer()` → `trustUser()` + `upsertContact()` | `user_peer_relations` upsert (`relation: 'trusted'`) + local cache; local contacts book | Cloud fail → `console.warn`, local cache still updated |
| **Block** | `handleBlockPeer()` → `blockUser()` + `disconnect()` | `user_peer_relations` upsert (`relation: 'blocked'`) + local cache | `setError` confirmation |

Trust/block sync via `trustSync.ts`: on login `bootstrapPeerRelations()` pulls cloud rows, merges with localStorage (`paranoic-trusted-ids-v1` / `paranoic-blocked-ids-v1`). First login uploads legacy local-only entries to cloud.

### Chat header

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Sidebar toggle** | Toggle messenger sidebar | None | — |
| **Back** | `navigateHome()` — UI only; P2P stays alive | None | — |
| **Peer name/avatar** | Open `PeerProfileModal` | None | Disabled without `activePeerId` |
| **Phone** | `dialFromChat()` → `startCall()` or reconnect + call | P2P + `call_sessions` | Ban/media/no-peer errors |
| **Attach** | File picker → `sendMedia` | Same as compose | Same |

### Peer Profile Modal (`PeerProfileModal.tsx`)

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| Backdrop / **Close** | `onClose()` | None | — |
| **Copy ID** | `navigator.clipboard.writeText(peer.id)` | None | Empty catch |
| **Copy magic link** | Copy `buildMagicLink(handle)` | None | Empty catch; 1.6 s checkmark |
| Media grid item | Open in new tab | In-memory chat blob URLs | Read-only |

---

## 5. P2P Video Calls

### Architecture

Two signaling layers run in parallel:

1. **Room P2P** (`p2p.ts`) — Supabase Realtime channel `room:{roomId}` for WebRTC handshake + `ctrl` for in-call media signaling (DataChannel primary, Realtime backup).
2. **Call inbox** (`callSignaling.ts`) — channel `calls:{userId}` for Caller ID (`call_offer` / `call_reject` / `call_cancel`).
3. **Persistence** (`callSessions.ts`) — table `call_sessions` (direct PostgREST; **no RPC**).

### Call state machine

```
idle → calling → in-call     (outbound)
idle → ringing → in-call     (inbound)
ending                       (teardown)
```

### Database: `call_sessions`

| Column | Purpose |
|--------|---------|
| `call_id` (PK) | UUID for the call |
| `from_user_id`, `to_user_id` | Participants |
| `status` | `ringing` \| `accepted` \| `cancelled` \| `rejected` \| `ended` |
| `updated_at` | Poll ordering |

| Function | Operation | Error handling |
|----------|-----------|----------------|
| `upsertCallSession` | `.upsert(..., onConflict: 'call_id')` | `console.warn`, silent return |
| `updateCallSessionStatus` | `.update({ status }).eq('call_id')` | Same |
| `fetchRingingCallsForUser` | SELECT ringing for callee | Returns `[]` on error |

`from_user_id` is always taken from live auth session, not caller params.

### Incoming Call Modal (`IncomingCallModal.tsx`)

| Control | Action | Signaling / DB | Error handling |
|---------|--------|----------------|----------------|
| **Decline** | `declineMediaCall()` | `callInbox.sendReject`, `updateCallSessionStatus('rejected')`, `p2p.declineCall` if ringing | Stops ringtone |
| **Accept** | Family: switch to Paranoic + `acceptMediaCall()`; else `acceptMediaCall()` | `updateCallSessionStatus('accepted')`, `p2p.acceptCall`, SDP exchange | `mediaBlocked` → CSS only; App declines if blocked |

Rendered in Family overlay and Paranoic shell when `incomingRing` is set.

### Call Overlay (`CallOverlay.tsx`)

| Control | Action | Signaling / DB | Error handling |
|---------|--------|----------------|----------------|
| **Active call banner** | Expand overlay | None | — |
| **Accept** (ringing card) | `acceptMediaCall()` | P2P + `call_sessions` | `setError` on fail |
| **Decline** | `declineMediaCall()` | reject + decline | — |
| **Hang up** | `cancelCall()` | cancel/end session + `p2p.cancelCall` | try/catch swallow |
| **Failure close (X)** | Same as hang up | Clears `callFailKind` | — |
| **Minimize** | Collapse overlay; streams kept alive | None | — |
| **Mic toggle** | `p2p.toggleAudio` | Local track only | — |
| **Camera toggle** | `p2p.toggleVideo` | Local track only | — |
| **Switch camera** | `p2p.switchCamera()` | WebRTC `replaceTrack` | `setError(mediaErrorMessage(...))` |
| **Attach file** | Opens file input → P2P file transfer | P2P | sendMedia errors |
| **Swap PiP** | Local layout toggle | None | — |

> **Note:** Screen-share prop is passed from App but **not rendered** in CallOverlay JSX.

### Guest Direct Call (`GuestDirectCall.tsx`)

Shown when guest opens magic link (`guestPeerId && !connected`).

| Control | Action | Signaling / DB | Error handling |
|---------|--------|----------------|----------------|
| **Back** | `leaveGuestUi()` | Disconnect guest session | — |
| **Call CTA** | `guestCallHost()` → `pendingStartCallRef`; on connect → `startCall()` | Room join + P2P | Ban/self/media → App `setError` |
| **Cancel** | `cancelCall()` | Full teardown + guest exit | — |

### App.tsx call handlers (summary)

| Handler | Trigger | Key steps |
|---------|---------|-----------|
| `startCall()` / `dialFromChat()` | Call buttons | `checkCalleeOnline(profiles)` → `upsertCallSession(ringing)` → `callInbox.sendOffer` → `p2p.startCall()` |
| `acceptMediaCall()` | Accept in modal/overlay | Media check → `updateCallSessionStatus('accepted')` → `p2p.acceptCall()` / room accept |
| `declineMediaCall()` | Decline | `sendReject` + `updateCallSessionStatus('rejected')` + `p2p.declineCall` |
| `cancelCall()` | Hang up / cancel | Inbox cancel + session status + `p2p.cancelCall()` + presence cleanup |

### Inbound call sources

1. `CallInbox.onOffer` → `IncomingCallModal`
2. FCM push → same handler
3. `fetchRingingCallsForUser` poll (8 s fallback)
4. P2P `onIncomingCall` → ringtone; auto-accept if `pendingRingAcceptRef`
5. Magic-link `onIncomingConnection` → auto `acceptIncomingConnection()`

### Failure classification

- **`declined`** — callee rejected
- **`offline`** — timeout, ICE failure, unreachable peer

Family mode routes P2P errors to `callAlert` instead of global toast.

---

## 6. Settings & Profile

### Settings Panel (`SettingsPanel.tsx`)

**Persistence:** `localStorage` key `paranoic-settings-v1` via `saveSettings()` / `loadSettings()`

#### Privacy

| Control (i18n) | Action | Backend | Error handling |
|----------------|--------|---------|----------------|
| **Ghost Mode** | `patch({ ghostMode })` | `localStorage`; map/presence use Antarctica coords | Silent |
| **Hide notification preview** | `patch({ notificationPreview: !hide })` | `localStorage` | Silent |
| **Delete after 24 hours** | `patch({ ephemeral24h })` | `localStorage`; triggers storage re-estimate | Silent |

#### Notifications

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Notifications** toggle | `patch({ notificationsEnabled })`; if enabling → `ensureNotifyPermission()` | `localStorage` + browser Notification API | **No UI feedback** if permission denied |

#### Data & storage

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Local storage** (read-only) | Shows `navigator.storage.estimate()` usage | Browser API | Falls back to "Stored on this device" |
| **Clear old messages** | `purgeExpiredMessages(EPHEMERAL_TTL_MS)` | IndexedDB `messages` + orphaned media | Success/fail hint in `purgeHint`; disabled while purging |

#### Devices

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **This device** row | `deviceLabel()` from `navigator.userAgent` | None | — |

#### Power

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Power saving** | `patch({ powerSaving })` | `localStorage`; adds `power-saving` class on `<html>`/`<body>` | Silent |

#### Language (Top 10 i18n)

Supported: **en, ru, pl, es, fr, de, zh, pt, ar, ua** (`APP_LANGUAGES` in `settings.ts`). Italian (`it`) replaced by Ukrainian; legacy `uk` alias → `ua`.

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Interface language** row | Opens `LanguagePickerModal` | None | — |
| Language option (modal) | `changeLanguage(id)` → `setLanguage()` + `saveSettings({ language })` | `localStorage`; `LanguageContext` updates `document.documentElement.lang` and RTL for `ar` | Silent; UI re-renders instantly via context |
| Modal close / backdrop / Escape | `onClose()` | None | — |

Legacy saved languages (`uk`→`ru`, `tr`/`ja`/`ko`→`en`) migrate via `normalizeLanguage()`.

#### Footer

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| **Map** | `onOpenFamilyMap()` → `setAppMode('family')` | None | — |
| **Admin Panel** | `onOpenAdmin()` | Admin dashboard | Visible only if `isAdmin` |

---

### Profile Home (`ProfileHome.tsx`)

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| Avatar / **Photo** | File picker → `uploadAvatar()` → `updateIdentity({ avatarUrl })` | R2 or data-URL fallback; **localStorage only** (not Supabase until ProfileModal save) | `setError(profile.uploadFailed)` |
| Name + pencil / Settings icon | `onOpenEditor()` → `ProfileModal` | None | — |
| **User ID** chip | Copy to clipboard | None | `setError(profile.copyIdFailed)` |
| **Magic link** chip | `onCopyMagicLink()` → App `copyMagicLink()` | None | **No try/catch in App** — clipboard fail may throw |
| Media archive item | Open preview overlay | IndexedDB media + local view counts | Silent if blob missing |
| Preview backdrop | Close preview | None | — |

### Profile Modal (`ProfileModal.tsx`)

Fully localized via `t()`. Compact layout with Zip Lift theme slider and round privacy icon toggles.

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| Backdrop / **Close** | `handleDismiss()` — reverts unsaved theme spectrum | None | — |
| **Upload / Change photo** | `uploadAvatar()` → local state | R2 | Inline error until Save |
| **Display name** | Saved on **Save** | `updateIdentity({ name })` | — |
| **Username** | Live `validateUsername` + debounced `isUsernameAvailable` → `profiles` | Saved on Save via `syncProfileToSupabase` | Username taken on save |
| **Password** | Optional; min 4 chars | `profiles.password` hash on save | Validation errors inline |
| **Zip Lift slider** | Drag/click morphs theme live via `applyThemeSpectrum()` | `saveSettings({ themeSpectrum })` on change; revert on dismiss without save | Dispatches `paranoic-theme-spectrum` for Mapbox |
| **Ghost Mode** icon | Round toggle → `saveSettings({ ghostMode })` immediately | `localStorage` | Accent glow when active |
| **24h deletion** icon | Round toggle → `saveSettings({ ephemeral24h })` | `localStorage` | Accent glow when active |
| **Magic link / User ID** cards | Stacked full-width cards with header copy buttons | Clipboard | Copied state glow |
| **Save** | `updateIdentity` + `shellBackgroundAt(themeSpectrum)` + `syncProfileToSupabase` | Supabase `profiles` + `theme_fon` | `setError(...)`; disabled while busy |
| **Sign out** (icon) | Confirm → `signOutAndReset()` | `supabase.auth.signOut`, clear local identity | Confirm cancel = no-op |

#### Zip Lift theme spectrum (`themeSpectrum.ts`)

| Stop | Label | Map preset | Notes |
|------|-------|------------|-------|
| 0 | Dark | `night` | Default |
| 28 | Neon | `night` | Cyan accent |
| 52 | UA | `dusk` | Toggles `html.theme-ua` easter egg (blue/gold palette) |
| 76 | US | `dusk` | Red/blue accent |
| 100 | Aurora | `night` | Purple/pink |

Setting stored as `themeSpectrum` (0–100) in `paranoic-settings-v1`. App shell uses `var(--app-shell-bg)`. Legacy `themeFon` swatches migrated via `migrateThemeSpectrumFromFon()` on first open.

---

## 7. Admin Dashboard

**File:** `src/AdminDashboard.tsx`  
**Access:** `profiles.role === 'admin'`  
**Backend:** `src/admin.ts`

| Control | Action | Backend | Error handling |
|---------|--------|---------|----------------|
| Backdrop / **Закрыть** | `onClose()` | None | — |
| **Refresh** | `load()` → `listAllProfiles()` | SELECT `profiles` (all rows) | Error message in dashboard |
| **Ban / Unban** | `toggleBan(user)` → `setUserBanned()` | UPDATE `profiles.is_banned` | Inline error |
| **Delete user** | `removeUser(user)` → `deleteUserAccount()` | DELETE `profiles`; remove avatar from Storage `avatars` bucket | Inline error; confirm implied in handler |

Banned users are blocked from chat/call entry points in App via `fetchMyAccessFlags()`.

---

## 8. Cross-Cutting Data Stores

### Supabase tables (no app RPCs)

| Table | Purpose |
|-------|---------|
| `profiles` | User profile, username, avatar, presence, role, ban, premium; global search via `searchProfilesGlobally()` |
| `messages` | Store-and-forward encrypted offline messages |
| `call_sessions` | Call state persistence |
| `memory_gems` | Unified map memory pins (visibility, media, coordinates) |
| `gem_likes`, `gem_comments` | Gem social |
| `user_peer_relations` | Cloud-synced trusted/blocked peer IDs per user |

> **Legacy:** `map_gems` table may still exist in older deployments; app no longer writes to it. Migration script: `supabase/memory_gems_unified.sql`.

### Storage buckets

| Bucket | Purpose |
|--------|---------|
| `offline-transfers` | Encrypted chat media ciphertext |
| `avatars` | Profile avatars (Supabase Storage) |

### External services

| Service | Purpose |
|---------|---------|
| Cloudflare R2 | Gem media, avatars (primary upload path) |
| Mapbox | Map tiles and rendering |
| Supabase Realtime | Room signaling, call inbox, presence |
| FCM (optional) | Push for incoming calls/messages |

### Local-only stores

| Key / store | Purpose |
|-------------|---------|
| `paranoic-settings-v1` | App settings (incl. `themeSpectrum`, `language`) |
| `paranoic-identity-v1` | Local identity |
| `paranoic-session-v1` | Saved login session |
| `paranoic-trusted-ids-v1` | Trusted contacts cache (synced from `user_peer_relations`) |
| `paranoic-blocked-ids-v1` | Blocked users cache (synced from `user_peer_relations`) |
| IndexedDB (`messages`, `media`) | Chat history and attachments |
| IndexedDB (`contacts` store) | Address book entries |

---

## 9. Known Gaps & Risks

| Area | Issue | Severity |
|------|-------|----------|
| Auth | Google OAuth implemented but not wired in UI | Low |
| Auth | No inline nickname validation in AuthScreen | Low |
| Profile | Avatar upload in ProfileHome saves locally only until ProfileModal save | Medium |
| Profile | Magic link copy in ProfileHome has no clipboard error handling | Low |
| Settings | Notification permission denial has no user feedback | Low |
| Map | Many gem UI strings still hardcoded Russian in composer targeting/move modes | Medium |
| Map | `memory_gems_unified.sql` must be run manually in Supabase for visibility column + migration | Medium |
| Trust/Block | `user_peer_relations.sql` must be run manually; offline changes queue locally only | Medium |
| Contacts search | Global `ilike` search requires RLS allowing authenticated SELECT on `profiles` | Medium |
| Calls | `call_sessions` DB errors are non-blocking (warn only) | Low |
| Calls | Screen-share handler passed but not rendered in CallOverlay | Low |
| Calls | Dual ringing UIs (modal vs overlay) — overlay suppressed when modal shown | Info |
| i18n | Partial coverage — map targeting strings, some admin copy still hardcoded | Low |
| Admin | Delete user does not cascade auth.users | Medium |

---

## File Index

| Area | Primary files |
|------|---------------|
| App shell | `src/App.tsx`, `src/LiquidNavigationBar.tsx` |
| Auth | `src/AuthScreen.tsx`, `src/authCredentials.ts`, `src/identity.ts` |
| Map | `src/GlobeLobby.tsx`, `src/lib/mapbox.ts`, `src/memoryGems.ts`, `src/mapGems.ts` |
| Gems UI | `src/MemoryGemComposer.tsx`, `src/MemoryGemDrawer.tsx` |
| Chat | `src/App.tsx`, `src/storage.ts`, `src/storeForward.ts`, `src/outbox.ts` |
| Search / contacts | `src/ChatSearchPanel.tsx`, `src/ContactsSearchPanel.tsx`, `src/ContactListRow.tsx`, `src/contacts.ts` |
| Trust / block | `src/trust.ts`, `src/trustSync.ts` |
| Theme (Zip Lift) | `src/themeSpectrum.ts`, `src/ZipLiftSlider.tsx`, `src/ProfilePrivacyIcons.tsx` |
| Calls | `src/p2p.ts`, `src/callSignaling.ts`, `src/callSessions.ts`, `src/IncomingCallModal.tsx`, `src/CallOverlay.tsx`, `src/GuestDirectCall.tsx` |
| Settings / i18n | `src/SettingsPanel.tsx`, `src/settings.ts`, `src/i18n/*` |
| Profile | `src/ProfileHome.tsx`, `src/ProfileModal.tsx`, `src/PeerProfileModal.tsx`, `src/profile.ts` |
| Admin | `src/AdminDashboard.tsx`, `src/admin.ts` |
| SQL schema | `supabase/*.sql` (incl. `memory_gems_unified.sql`, `user_peer_relations.sql`) |

---

*Generated from static codebase analysis. Runtime behavior may vary with Supabase RLS policies, env vars (`VITE_MAPBOX_TOKEN`, Supabase URL/key), and browser permissions (camera, mic, notifications, geolocation).*
