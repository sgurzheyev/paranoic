# Paranoic Application Audit

Functional audit of the Paranoic encrypted messenger + Family map (React + Vite + Capacitor Android).  
Verified against the **current `main` codebase** — not copied from the 2026-08-23 audit.

**Audit date:** 2026-09-12  
**Branch audited:** `main` @ `f927c93` (`feat(calls): add WebRTC mesh group audio and video calls`)  
**Also reviewed:** open draft **PR #1** `cursor/fix-1-1-call-connection-fed9` — *not merged*.  
**Method:** static code walk of UI wiring + local stores + Supabase/R2/Realtime/FCM/Capacitor paths. No two-device live call was run in this pass.

**Status key**

| Tag | Meaning |
|-----|---------|
| **WORKS** | UI + store/backend path exist and look end-to-end |
| **PARTIAL** | Implemented but incomplete, fragile, or env/SQL dependent |
| **BROKEN / HIGH RISK** | Known failure or a security/reliability hole that can silently break the feature |
| **MISSING** | Expected of a modern messenger; not present |

---

## Executive summary

Paranoic is a working **account-gated** web/Android shell: email/password auth, local address book, 1:1 and group chats with AES-GCM ciphertext, store-and-forward, a Mapbox Family map with unified memory gems, profile/settings/i18n, block/report, and a Capacitor Android project.

The headline gap vs the August audit is **groups + mesh group calls** (landed on `main`) and a still-open **1:1 media-connection split-brain**. Ringing/UI on `main` can succeed while WebRTC media never completes. PR #1 documents and patches that handshake; it is **not** on `main`.

Treat “E2EE” as **client-side AES-GCM with a deterministic room key**, not Signal-style identity keys. Anyone who knows `inbox-{userId}` / `group-{groupId}` can derive the same AES key (`deriveKeyFromRoom`). Ciphertext in Supabase is not a server-blind protocol.

---

## What changed since the 2026-08-23 audit

The old audit is stale. On `main` since then:

| Area | Now on `main` |
|------|----------------|
| Groups | Create / manage / Realtime + SAF fan-out (`groups.ts`, `supabase/groups.sql`) |
| Group calls | WebRTC mesh A/V (`groupCall.ts`, `GroupCallGrid.tsx`) |
| Chat UX | Private address book, header `···` menu, mute, clear history |
| Calls | Self-call block, explicit-call-only, inbox wake-before-invite, iOS video-reattach hardening — **media handshake bugs remain** |
| Auth | Forgot-password + recovery mode in `AuthScreen` (was missing in Aug) |
| Safety | `blocked_users` + `reports` + `UserActionsPanel` (Play-style block/report) |
| Admin | Super-admin `AdminPanel` (users / capsules / reports) vs role-admin `AdminDashboard` |
| Storage | `StorageManagementModal` (messages / images / videos / Mapbox tiles) |
| Push | Capacitor FCM token → `profiles.fcm_token` (receive path only) |
| Android | Capacitor 8 project `men.paranoic.app`, camera/mic/GPS/notification permissions |

---

## PR #1 (call-fix) — relevant, not on `main`

**PR:** [#1](https://github.com/sgurzheyev/paranoic/pull/1) — draft — `fix(calls): restore 1:1 WebRTC media connection after ring`  
**Touches:** `src/App.tsx`, `src/p2p.ts` only. Group/mesh calls out of scope.

Verified **still present on `main`:**

1. **Callee often not hosting `inbox-{self}`** — after chat Back, P2P stays in the last peer room; caller always joins `inbox-{calleeId}`. `applyIncomingCallOffer` rings only; it does **not** rejoin the callee inbox as host.
2. **Silent DataChannel `connected` can wipe Accept/ring** — `onStatus('connected')` clears `incomingRing` unless `isCallUiLocked()` (which does **not** include a Realtime-only ring). It also sets `pendingRingAcceptRef = false`.
3. **Media ICE vs data-only SDP** — `onSignalIce` queues when there is no remote description or `have-local-offer`, but **not** when `pendingCallOffer` is set and `remoteDescription` is still the silent P2P SDP.
4. **`call-invite` dropped without a PC** — `handleControl` returns on `if (!this.pc) return` *before* `call-invite`.
5. **Call tap force-resubscribes** — `wakeCallSignaling()` → `callInbox.ensureAlive({ force: true })` and `ensureSignalingAlive('call-click')` (force-wake even when the channel is `joined`).
6. **Host inbox dies on `CHANNEL_ERROR`** — room subscribe sets `failed` and does not recover with backoff.
7. **Outbound invite can hit the caller’s empty inbox** — `startCall()` sends `call-invite` on the current room; if the caller is hosting `inbox-{me}` with no DC to the callee, the invite is broadcast to the wrong channel.

**After PR #1 (if merged):** 1:1 Accept → in-call media should work from Contacts and from an open chat, including Accept-before-DC. **Still remaining even after PR #1:** dead/rate-limited public Open Relay TURN unless `VITE_TURN_*` is set; group-call subscribe-to-hear-invite; 1:1 vs group mic contention.

---

## 1. WORKS

Features that are implemented and appear wired end-to-end (UI + backend or local store).

### Auth

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Email + password sign-up / sign-in | WORKS | `src/AuthScreen.tsx`, `src/authCredentials.ts`, `src/lib/supabase.ts` | Supabase Auth + `profiles` upsert | `submit()` → `signInWithEmailPassword` / `signUpWithEmailPassword`; nickname `validateUsername` + `isUsernameAvailable` |
| Email confirmation pending | WORKS | `src/authCredentials.ts`, `src/AuthScreen.tsx` | Supabase Auth | No session after `signUp` → `pendingConfirmation` → `t('auth.confirmEmail')` |
| Forgot password + recovery | WORKS | `src/AuthScreen.tsx`, `src/authCredentials.ts` | Supabase Auth reset email | `requestPasswordReset` / `completePasswordReset`; recovery mode via `isPasswordRecoveryPending()` |
| Session restore after refresh | WORKS | `src/App.tsx`, `src/lib/supabase.ts` | Supabase session | Auth gate `peekAuthSession()`; no anonymous login |
| Sign out | WORKS | `src/ProfileModal.tsx`, `src/lib/supabase.ts` | `auth.signOut({ scope: 'local' })` | Confirm → `signOutAndReset()` |
| Username uniqueness | WORKS | `src/identity.ts`, `src/authCredentials.ts` | `profiles.username` | Pattern `^[a-z][a-z0-9_]{2,23}$`; conflict mapped to “никнейм уже занят” |

### Chats / offline / local UX

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| 1:1 text send (live) | WORKS | `src/App.tsx` `sendText()`, `src/p2p.ts`, `src/crypto.ts` | P2P DataChannel | Encrypt AES-GCM → `p2p.send(packet)` when `isReady` |
| 1:1 text send (offline) | WORKS | `src/storeForward.ts`, `src/outbox.ts` | `messages` + IndexedDB outbox | `uploadPendingText` then `enqueueOutbox` fallback; sync every 45s + `online` + foreground resume |
| 1:1 media / files | WORKS | `src/App.tsx` `sendMedia()`, `src/storeForward.ts` | P2P file DC or `offline-transfers` bucket | Progress UI; 16 MB SAF cap |
| Voice notes + video circles | WORKS | `src/ChatRecordButton.tsx`, `src/mediaNotes.ts` | Same as media | Hold-to-record; `mediaKind` `'voice' \| 'circle'` |
| Local chat history + previews | WORKS | `src/storage.ts`, `src/App.tsx` | IndexedDB `messages` / `media` | `loadLastMessagePreviews`; chats + groups ordered by preview time |
| Local chat search | WORKS | `src/ChatSearchPanel.tsx`, `src/storage.ts` | IndexedDB only | Filters All / Media / Links / Files / Voice |
| Mute conversation | WORKS | `src/App.tsx` `handleToggleMute`, `src/storage.ts` | Local mute set | Header `···` → mute; suppresses notify for that conv |
| Clear history | WORKS | `src/App.tsx` `handleClearHistory`, `src/storage.ts` | IndexedDB | `clearConversation` + confirm in `ChatHeader` |
| Typing indicator (1:1 live) | WORKS | `src/p2p.ts` `sendTyping`, `src/App.tsx` | DataChannel only | Header + compose dots when DC is up |
| Delivery / read ticks (1:1 live) | WORKS | `src/p2p.ts` `sendMessageAck`, `src/App.tsx` | DataChannel only | `delivered` / `read` on live P2P; not for SAF/group |
| Heart reaction (1:1 live) | WORKS | `src/p2p.ts` `sendReaction` | DataChannel only | Double-tap; not persisted server-side |
| Foreground recover | WORKS | `src/App.tsx` | REST + Realtime + Capacitor `appStateChange` | Re-sync SAF, flush outbox, wake inbox/signaling |

### Contacts

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Local address book | WORKS | `src/contacts.ts` | IndexedDB `contacts` | `upsertContact` / `loadContacts`; sources `magic` / `hello` / `manual` / `trust` / `call` |
| Private names + note | WORKS | `src/localContacts.ts`, `src/EditContactModal.tsx`, `src/ChatHeader.tsx` | IndexedDB `local_contacts` only | First / last / note never uploaded |
| Global profile search | WORKS | `src/ContactsSearchPanel.tsx`, `src/profile.ts` | `profiles` (`PROFILE_PUBLIC_COLUMNS`) | UUID, `@username`, `?u=` magic link, name `ilike`; skips banned |
| Add / chat / call from Contacts | WORKS | `src/App.tsx`, `src/ContactListRow.tsx` | `profiles` validate + P2P | `handleAddGlobalContact`, `quickChatContact`, `handleContactsRowCall` |
| Delete contact | WORKS | `src/UserActionsPanel.tsx`, `src/App.tsx` | Local book | Safety panel + confirm |

### Groups

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Create group | WORKS | `src/CreateGroupModal.tsx`, `src/groups.ts` `createGroup` | `groups` + `group_members` | Creator admin; ≥1 other member; max 20 |
| List + open group chat | WORKS | `src/App.tsx`, `src/GroupListRow.tsx` | Same + IndexedDB `group:{id}` | Subscribes `group:{id}` after Realtime auth |
| Live group text | WORKS | `src/groups.ts` `broadcastGroupMessage`, `src/App.tsx` `sendText` | Realtime broadcast + AES-GCM | Cipher over `group_msg` |
| Group offline fan-out | WORKS | `src/storeForward.ts` `uploadPendingGroupText` / `Media` | `messages.group_id` + storage | One ciphertext per member inbox |
| Manage members / rename / leave / delete | WORKS | `src/GroupManagementModal.tsx`, `src/groups.ts` | `group_members` / `groups` | Admin add/remove/rename/delete; leave promotes last admin |
| Group chat header | WORKS | `src/ChatHeader.tsx` | None | Stacked faces; audio/video call buttons |

### Family map & gems

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Mapbox globe | WORKS | `src/GlobeLobby.tsx`, `src/lib/mapbox.ts` | Mapbox (`VITE_MAPBOX_TOKEN`) | Missing token → overlay + Back |
| Presence avatars + GPS | WORKS | `src/presence.ts`, `src/GlobeLobby.tsx` | `profiles` + Realtime presence | Heartbeat 15s; Ghost Mode → Antarctica `-78.5, 16.5` |
| Unified memory gems CRUD | WORKS | `src/memoryGems.ts`, `src/MemoryGemComposer.tsx`, `src/MemoryGemDrawer.tsx` | `memory_gems` + R2 `map-gems/` | `visibility` `private` / `family` / `public`; `canViewGem()` client filter |
| Gem likes / comments | WORKS | `src/gemSocial.ts`, `src/MemoryGemDrawer.tsx` | `gem_likes`, `gem_comments` | Optimistic toggle + rollback |
| Owner edit / move / delete | WORKS | `src/memoryGems.ts`, `src/GlobeLobby.tsx` | UPDATE/DELETE + R2 delete | Targeting + move-pin modes |
| Zip Lift ↔ map preset | WORKS | `src/themeSpectrum.ts`, `src/GlobeLobby.tsx` | localStorage | `paranoic-theme-spectrum` → Mapbox `lightPreset` |
| Layers (contacts / pins / ghost) | WORKS | `src/GlobeLobby.tsx` | local settings + re-fetch gems | Standard dock + zoom |

### Profile / settings / i18n / theme

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Profile editor (name, username, avatar, password) | WORKS | `src/ProfileModal.tsx`, `src/profile.ts` | `profiles` + R2/avatars | Save → `updateIdentity` + `syncProfileToSupabase` |
| Profile home + media archive | WORKS | `src/ProfileHome.tsx`, `src/storage.ts` | IndexedDB media | Local archive + view counts (`mediaViews.ts`) |
| Magic link + User ID copy | WORKS | `src/identity.ts` `buildMagicLink`, Profile / Peer modals | None | `/?u=username` or id |
| Zip Lift theme 0–100 | WORKS | `src/themeSpectrum.ts`, `src/ZipLiftSlider.tsx` | `paranoic-settings-v1` | Dark / Neon / UA / US / Aurora; `theme-ua` easter egg |
| Settings: ghost, 24h purge, notify, power, language | WORKS | `src/SettingsPanel.tsx`, `src/settings.ts` | localStorage + Notification API | Toggles persist; 24h → `purgeExpiredMessages` |
| Storage manager | WORKS | `src/StorageManagementModal.tsx`, `src/storageManagement.ts` | IndexedDB + Cache API `mapbox-tiles` | Per-category clear |
| Language picker | WORKS | `src/i18n/*`, `src/settings.ts` | localStorage | en, ru, pl full; es/fr/de/zh/pt/ar/ua merged patches; RTL for `ar` |
| Bottom nav | WORKS | `src/LiquidNavigationBar.tsx`, `src/App.tsx` | None | Chats / Contacts / Settings / Profile; hidden in chat/call/guest |

### Trust / block / report

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Trust / block cloud sync | WORKS | `src/trust.ts`, `src/trustSync.ts` | `user_peer_relations` + localStorage cache | `bootstrapPeerRelations()` on login |
| Trust banner on new peer | WORKS | `src/App.tsx` | Same + contacts book | Shown when chat open, untrusted, has incoming msgs |
| Block + report UI | WORKS | `src/UserActionsPanel.tsx`, `src/userSafety.ts`, `src/ChatHeader.tsx` | `blocked_users`, `reports` | Reasons spam/harassment/…; mirrors `trust.blockUser` |
| Enforce block on connect / inbound ring | WORKS | `src/App.tsx` | Local blocked set | `isBlocked` aborts connect; `applyIncomingCallOffer` drops blocked callers |

### Admin

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Role-admin user list / ban / delete profile | WORKS | `src/AdminDashboard.tsx`, `src/admin.ts` | `profiles.is_banned` / DELETE | Gated `profiles.role === 'admin'` |
| Super-admin moderation | WORKS | `src/AdminPanel.tsx`, `src/adminModeration.ts` | users + capsules + `reports` | Username gate `@sgurzheyev` only |
| Ban blocks chat/call | WORKS | `src/App.tsx` `fetchMyAccessFlags` | `profiles.is_banned` | 45s poll; tears down P2P when banned |

### Guest / magic link

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Resolve `?u=` to host inbox | WORKS | `src/identity.ts`, `src/App.tsx`, `src/profile.ts` | `profiles` lookup | Guest joins `inbox-{host}`; host stays inbox host on home/map |
| Guest direct-call CTA | WORKS | `src/GuestDirectCall.tsx` | Room P2P + CallInbox | Shown while `guestPeerId && !connected` on home |
| In-app browser guard | WORKS | `src/main.tsx`, `src/InAppBrowserFallback.tsx` | None | Telegram/FB/IG/WA/Line WebView → “open in browser” (WebRTC blocked) |

### Android / Capacitor (project)

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Android wrapper | WORKS | `capacitor.config.ts`, `android/`, `src/main.tsx` | None | `appId` `men.paranoic.app`; `webDir` `dist`; `capacitor-android` class |
| Native permissions declared | WORKS | `android/app/src/main/AndroidManifest.xml` | OS | CAMERA, RECORD_AUDIO, LOCATION, POST_NOTIFICATIONS, FGS camera/mic |
| Resume recover on Android | WORKS | `src/App.tsx` | `@capacitor/app` | `appStateChange` → foreground recover |

---

## 2. PARTIAL

Implemented but incomplete, fragile, or easy to misconfigure.

### Auth

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Google OAuth | PARTIAL | `src/authCredentials.ts` `signInWithGoogleOAuth` | Supabase Google provider | Function exists; **no button** on `AuthScreen`. `AccountLoginPanel.tsx` is unused |
| Password strength | PARTIAL | `src/authCredentials.ts` | Auth | Client min **4** characters — not modern policy |
| Nickname UX | PARTIAL | `src/AuthScreen.tsx` | `profiles` | Validation only in auth layer, not live on the field |
| Dual password story | PARTIAL | `src/profile.ts`, `src/passwordAuth.ts` | `profiles.password` hash **and** Supabase Auth | Profile modal can write a PBKDF2 hash into `profiles`; login is Auth email/password. Confusing + leftover column |

### Chats / E2EE

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| “E2EE” | PARTIAL | `src/crypto.ts` `deriveKeyFromRoom` | Deterministic PBKDF2 from room id | Key = `paranoic-room:{inbox-id\|group-id}` + fixed salt. Server or anyone with the UUID can derive it. Not identity-key E2EE |
| Group ciphertext | PARTIAL | `src/groups.ts` `groupRoomId`, `src/crypto.ts` | Same | Shared room key for all members; no sender keys / FS |
| Offline ticks | PARTIAL | `src/App.tsx` `sendText` | `messages` | SAF path marks `delivered` after upload, not after recipient decrypt |
| Group delivery / typing / reactions | PARTIAL | `src/App.tsx`, `src/groups.ts` | Realtime | Text/media yes; no typing, no acks, no hearts on group channel |
| SQL / RLS | PARTIAL | `supabase/messages.sql`, `messages_rls_fix.sql`, `harden_rls_policies.sql` | Must be applied | Failures throw RLS hints; easy to break SAF if SQL skipped |

### Contacts

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Cloud address book | PARTIAL | `src/contacts.ts` | None | Book is **device-local**. New device = empty book (trust IDs sync; names do not) |
| Global search RLS | PARTIAL | `src/profile.ts`, `supabase/harden_rls_policies.sql` | `profiles` SELECT public | Works only if `profiles_select_public` (or equivalent) is applied |

### Groups

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Roles | PARTIAL | `src/groups.ts` | `admin` / `member` only | No moderator, no permission matrix, no invite links |
| Avatar | PARTIAL | `createGroup({ avatarUrl })` | `groups.avatar_url` | Column exists; create UI is name + members — no avatar picker wired |
| i18n | PARTIAL | `src/i18n/translations.ts` vs `locales/*` | None | `groups.*` exists in en/ru/pl only; es/fr/de/zh/pt/ar/ua **fall back to English** |
| Schema | PARTIAL | `supabase/groups.sql`, `supabase/migrations/20260903_*.sql` | Manual apply on older projects | RLS recursion fix is required (`20260903_groups_rls_fix.sql`) |

### 1:1 call UX (when media actually connects)

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Ring / decline / hangup / self-block | PARTIAL | `src/App.tsx`, `src/IncomingCallModal.tsx`, `src/CallOverlay.tsx` | `calls:{uid}` + `call_sessions` | UI + DB + inbox are wired; **media path is BROKEN** (below) |
| Mic / cam / flip camera / in-call file | PARTIAL | `src/CallOverlay.tsx`, `src/p2p.ts` | Local tracks + P2P | Controls exist; useless if ICE/SDP never completes |
| `call_sessions` | PARTIAL | `src/callSessions.ts` | `call_sessions` | Upsert/update **warn-only**; poll every 8s as ring fallback |
| Screen share | PARTIAL | `src/p2p.ts` `toggleScreenShare`, `src/App.tsx` | WebRTC | Handler passed into overlay; **no Share button** in `CallOverlay` JSX — status text only if already sharing |
| Dual ring UI | PARTIAL | `IncomingCallModal` + `CallOverlay` | None | Overlay ringing card suppressed when modal is shown |

### Group / mesh calls

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Mesh A/V | PARTIAL | `src/groupCall.ts`, `src/GroupCallGrid.tsx`, `src/App.tsx` | Realtime `group:{id}` events | Full-mesh `RTCPeerConnection` per remote; max 6 peers; invite/join/offer/answer/ice |
| Invite delivery | PARTIAL | `src/groups.ts` `subscribeGroupChannel` | Member must already be subscribed | App subscribes all groups after login — **offline / unsubscribed members miss the mesh** (same class of bug as 1:1 inbox-host) |
| TURN | PARTIAL | `src/p2p.ts` `buildIceServers`, `api/turn.ts` | Public Open Relay + optional `VITE_TURN_*` | Open Relay is often dead; 4G/5G needs a real TURN |
| Contention | PARTIAL | `src/App.tsx` `startGroupCall` | Mic/camera | Blocks if 1:1 live; reverse (1:1 while mesh live) is weaker |

### Map / gems / AI

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Family visibility | PARTIAL | `src/mapGems.ts` `canViewGem` | Client filter after SELECT | “Family” = viewer’s **local** contact IDs, not a server family graph |
| Free gem cap | PARTIAL | `src/mapGems.ts` `FREE_MAP_GEM_LIMIT = 5` | `profiles.is_premium` or `paranoic-premium-v1` | Paywall is a flag, not a payment flow |
| AR Footprints | PARTIAL | `src/ArFootprints.tsx` | Device WebXR / camera | Lazy overlay; falls back to camera; many strings hardcoded RU |
| AI Secretary | PARTIAL | `src/useAiSecretary.ts`, `src/AiBodyguardChat.tsx`, `supabase/functions/ai-secretary` | Edge Function → OpenAI | Works only if function + secrets deployed; errors → “Канал оборван” |
| Composer i18n | PARTIAL | `src/GlobeLobby.tsx` targeting/move | None | Several targeting strings still hardcoded Russian |

### Profile / i18n / settings

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Avatar from Profile home | PARTIAL | `src/ProfileHome.tsx` | R2/local until modal Save | Home upload updates local identity; cloud persist is ProfileModal Save |
| Locale coverage | PARTIAL | `src/i18n/translations.ts`, `src/i18n/locales/*` | None | en/ru/pl complete; others patches (missing `groups`, some `auth.reset*`, `chatMenu`). `locales/it.ts` exists but picker maps `it` → `en` |
| Notification permission UX | PARTIAL | `src/SettingsPanel.tsx`, `src/notify.ts` | Notification API | Enable calls `ensureNotifyPermission()`; **no UI if denied** |
| Devices | PARTIAL | `src/SettingsPanel.tsx` | UA string | “This device” only — no session list / remote logout |
| `profiles.password` column | PARTIAL / risky | `src/profile.ts` `PROFILE_COLUMNS` | `profiles` | Admin select includes `password`. RLS `profiles_select_public` is `using (true)` — hashes are readable if any client selects that column |

### Trust / safety

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Unblock | PARTIAL | `src/userSafety.ts` `unblockUserSafety` | `blocked_users` | API exists; chat menu shows “Blocked” disabled — **no unblock control** in the same panel |
| Report pipeline | PARTIAL | `src/adminModeration.ts` | `reports` | Insert works; resolution is super-admin only; no reporter feedback |
| SQL apply | PARTIAL | `supabase/user_peer_relations.sql`, `blocked_users_and_reports.sql`, migrations | Manual | Offline block/trust stay local until sync |

### Admin

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Delete user | PARTIAL | `src/admin.ts` `deleteUserAccount` | DELETE `profiles` + avatar objects | **Does not delete `auth.users`** — account can still sign in |
| Two consoles | PARTIAL | `src/App.tsx` | Role vs username | Super-admin sees `AdminPanel`; other admins see `AdminDashboard` (no reports/capsules) |
| Admin i18n | PARTIAL | `src/AdminPanel.tsx` | None | Tabs/copy hardcoded Russian |

### Push / FCM

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Token registration | PARTIAL | `src/pushNotifications.ts`, `src/profile.ts` `saveFcmToken` | `profiles.fcm_token` | Native only (`Capacitor.isNativePlatform()`); permission + channel `paranoic-calls` |
| Incoming-call push receive | PARTIAL | `src/pushNotifications.ts`, `src/App.tsx` | FCM data payload | Parses `call_offer` and calls `applyIncomingCallOffer` |
| **FCM send** | PARTIAL / missing server | — | **No sender in this repo** | No Edge Function / API writes FCM. Token is stored; **nothing here sends a push**. Background ring still depends on Realtime or 8s `call_sessions` poll while foreground |
| `google-services.json` | PARTIAL | `android/` | Firebase | **Not in the repo** — Capacitor Push plugin is declared, but Android FCM will not register without a Firebase app file |
| Hide preview | PARTIAL | `src/notify.ts` | Browser notifications | Honored for **web** `Notification`; native FCM payload is whatever the missing sender would send |

### Guest / magic link

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Guest chat | PARTIAL | `src/App.tsx` | P2P after DC | Guest UI is **call-first**. Chat opens after connect only if `outboundOpenChatRef` / navigation; not a full guest inbox |
| Guest without account | PARTIAL | `src/App.tsx` auth gate | Supabase Auth required | Comment: “Без JWT — AuthScreen, без anonymous.” Magic link does **not** skip login |

### Android / Capacitor

| Item | Status | Primary files | Backend | Evidence |
|------|--------|---------------|---------|----------|
| Release APK | PARTIAL | `android/app/release/output-metadata.json`, Auth download link | R2 CDN APK | Metadata references `app-release.apk`; AuthScreen hardcodes an R2 URL. APK binary is not necessarily in git |
| iOS | PARTIAL | `.env.example` `VITE_IOS_CLIENT_URL` | None | No `ios/` project in repo |
| Web vs native | PARTIAL | `src/main.tsx`, `src/pushNotifications.ts` | None | Same SPA; FCM native-only; in-app browsers blocked |

---

## 3. BROKEN / HIGH RISK

### 1:1 call media connection (main, without PR #1) — HIGH

| | |
|--|--|
| **Status** | **BROKEN** on `main`: ring/UI can succeed; media often never reaches `in-call` |
| **Files** | `src/App.tsx` (`applyIncomingCallOffer`, `wakeCallSignaling`, `onStatus`, `startCall`, `acceptMediaCall`), `src/p2p.ts` (`startCall`, `handleControl`, `onSignalIce`, `ensureSignalingAlive`, room `CHANNEL_ERROR`) |
| **Backend** | Supabase Realtime `calls:{userId}` + `room:inbox-{userId}`; `call_sessions`; STUN/TURN |
| **Evidence** | Split-brain: ring on CallInbox vs media on inbox room. See [PR #1 section](#pr-1-call-fix--relevant-not-on-main). Typical fail: both users tapped Back, A calls B from Contacts — B rings and Accepts, both wait forever. |

### Deterministic “E2EE” keys — HIGH

| | |
|--|--|
| **Status** | **HIGH RISK** if marketed as E2EE |
| **Files** | `src/crypto.ts` `deriveKeyFromRoom` |
| **Backend** | Ciphertext in `messages` / `offline-transfers` |
| **Evidence** | `PBKDF2(paranoic-room:${roomId}, salt paranoic-e2ee-v1)`. Room ids are `inbox-{uuid}` / `group-{uuid}`. No per-device keys, no forward secrecy, no safety numbers. |

### Public profiles RLS + password hashes — HIGH

| | |
|--|--|
| **Status** | **HIGH RISK** (deployment-dependent) |
| **Files** | `supabase/harden_rls_policies.sql` `profiles_select_public`, `src/profile.ts` `PROFILE_COLUMNS` |
| **Backend** | `profiles` SELECT `using (true)` for `anon, authenticated` |
| **Evidence** | Any client that `.select('...,password')` can read password hashes. `listAllProfiles` does exactly that. `fcm_token` is also a leak if selected. |

### TURN / mobile NAT — HIGH (calls)

| | |
|--|--|
| **Status** | **HIGH RISK** on cellular even after PR #1 |
| **Files** | `src/p2p.ts` `buildIceServers`, `api/turn.ts`, `.env.example` |
| **Backend** | Default Open Relay `openrelay.metered.ca` + Google STUN |
| **Evidence** | Comments and PR #1: public Open Relay is often dead/rate-limited. Production needs `VITE_TURN_URL` / `USER` / `CRED`. |

### FCM is receive-only — HIGH (background calls)

| | |
|--|--|
| **Status** | **BROKEN** as a wake-up system |
| **Files** | `src/pushNotifications.ts`, `supabase/fcm_token.sql` — **no sender** |
| **Backend** | Column + client register only |
| **Evidence** | Repo has zero FCM HTTP send / Cloud Function. Android without `google-services.json` will not get a token. Background callee relies on luck (Realtime if process alive). |

### Group mesh same inbox-class miss — HIGH

| | |
|--|--|
| **Status** | **HIGH RISK** |
| **Files** | `src/groupCall.ts`, `src/groups.ts` `broadcastGroupEvent` |
| **Backend** | `group:{id}` broadcast (not persisted) |
| **Evidence** | Invite is fire-and-forget Realtime. A member whose channel is down never rings. No `call_sessions`-style group fallback. |

### Host inbox `CHANNEL_ERROR` → `failed` — HIGH (1:1)

| | |
|--|--|
| **Status** | **BROKEN** recovery |
| **Files** | `src/p2p.ts` room subscribe (~L848) |
| **Backend** | Realtime |
| **Evidence** | Lost room channel sets `failed` unless already in-call; later inbound joins have no host until a full rejoin. |

---

## 4. MISSING

Obvious gaps vs a modern messenger (not implemented, or stub-only).

| Area | Missing |
|------|---------|
| **Auth** | Phone/SMS OTP, 2FA/TOTP, passkeys, wired Google/Apple buttons, session list, remote logout, password min ≥8 + breach check |
| **Chats** | Edit / delete-for-everyone, quoted reply, forward, pins, archive, folders, unread badge service, cloud search, link previews, polls, stickers/GIF picker, disappearing-for-peer (only local 24h purge), view-once media, backup/restore, multi-device crypto |
| **Groups** | Invite links / QR, @mentions, admin permission matrix, announcement groups, group E2EE sender keys |
| **Calls** | Screen-share **button**, group call on `call_sessions` / FCM, PSTN, call history log UI, noise cancellation, CallKit / ConnectionService |
| **Map** | Live location *in chat*, place search, server-side family graph |
| **Profile** | QR of magic link, username reservation flow beyond save, verified badges |
| **Safety** | Unblock UI, report-and-block combo default, screenshot deterrence, sealed-sender |
| **Push** | Server FCM/APNs sender, web Push, message-content push (intentionally limited) |
| **Platform** | iOS Xcode project, desktop app, SMS registration |
| **Payments** | Real premium / gem IAP (flag only) |

---

## Messenger gap list

Famous-app features Paranoic lacks or only partially has:

- **Signal-grade E2EE** — no identity keys, no safety number, no FS. Deterministic room PBKDF2 only.
- **Multi-device** — new browser/phone does not share the local address book or message archive (IndexedDB).
- **Phone number identity** — username + email only.
- **2FA / registration lock**
- **Message edit / unsend for both sides**
- **Quoted replies and threads**
- **Forward + “forwarded from”**
- **Read receipts that work offline** — ticks are live-DC only (1:1).
- **Typing in groups**
- **Pinned / archived chats and folders**
- **Statuses / Stories**
- **Stickers, GIFs, emoji picker** (plain text + files + voice/circle only)
- **View-once media** (`mediaViews.ts` is a local play-count, not view-once)
- **Disappearing messages the peer enforces** — 24h is a *local* IndexedDB purge
- **Cloud chat backup / encrypted restore**
- **Desktop client** (web only + Android wrapper)
- **Link previews**
- **Polls**
- **In-chat live location** (map is a separate Family mode)
- **Username QR**
- **Group invite links**
- **Call history list** (DB rows exist for 1:1; no UI)
- **Reliable background ringing** (no FCM sender; no CallKit)
- **Screen share control** (API yes, button no)
- **Sealed-sender / metadata protection** (Supabase sees who→whom, group membership, gem coordinates)
- **Moderation at scale** — super-admin is a hardcoded username
- **i18n completeness** — groups + much of admin/map still EN/RU

What it **does** have that many clones skip: magic-link guest call, Family map + memory gems, Ghost Mode, local-only private notes, store-and-forward ciphertext, mesh group calls (fragile), Zip Lift theme, Capacitor Android shell.

---

## Area checklist (requested coverage)

| Area | Headline |
|------|----------|
| **Auth** | WORKS (email/password + reset). Google unused. No 2FA. |
| **Chats / E2EE / offline** | WORKS for send/receive/SAF/voice. E2EE is deterministic-room — PARTIAL/HIGH. |
| **Contacts** | WORKS locally + global search. No cloud book. |
| **Groups** | WORKS CRUD + Realtime/SAF. Weak crypto + EN-only i18n for most locales. |
| **1:1 Calls** | UI WORKS; **media handshake BROKEN on `main`** (PR #1). |
| **Group / mesh Calls** | PARTIAL mesh; subscribe-or-miss; TURN risk. |
| **Family map & gems** | WORKS end-to-end if Mapbox + R2 + SQL applied. |
| **Profile / settings / i18n / theme** | WORKS; locale patches incomplete; leftover `profiles.password`. |
| **Trust / block / report** | WORKS insert + enforce; unblock UI missing. |
| **Storage / privacy** | WORKS local manager + 24h purge. No remote wipe. Public profile SELECT is broad. |
| **Admin** | WORKS for gated roles; delete does not drop Auth user. |
| **Push / FCM** | PARTIAL client; **no sender**; no `google-services.json`. |
| **Guest / magic link** | WORKS after login; call-first guest; in-app browsers blocked. |
| **Android / Capacitor** | WORKS project + permissions; FCM incomplete; no iOS tree. |

---

## Backend / SQL / env checklist

Manual SQL still matters (many files are editor scripts, not all auto-migrated):

| Script | Needed for |
|--------|------------|
| `supabase/profiles.sql` + `usernames.sql` + `auth_nickname_password.sql` | Auth profiles |
| `supabase/messages.sql` + `messages_rls_fix.sql` | Offline chat |
| `supabase/call_sessions.sql` | Ring persistence / poll |
| `supabase/groups.sql` + `migrations/20260903_groups.sql` + `20260903_groups_rls_fix.sql` | Groups |
| `supabase/memory_gems.sql` + `memory_gems_unified.sql` + gem social | Map pins |
| `supabase/user_peer_relations.sql` | Cloud trust/block |
| `supabase/blocked_users_and_reports.sql` + `reports_moderation.sql` | Play safety |
| `supabase/fcm_token.sql` | Token column |
| `supabase/harden_rls_policies.sql` | RLS (and public profile select) |
| `supabase/admin.sql` | `role` / `is_banned` |
| `supabase/functions/ai-secretary` | Map AI |

**Env (`.env.example`):** `VITE_SUPABASE_*`, `VITE_MAPBOX_TOKEN`, `VITE_TURN_*`, `VITE_R2_*`, optional APK/TestFlight URLs.

**Buckets:** `offline-transfers`, `avatars`; R2 for gems/avatars.

**No app RPCs** — all PostgREST + Realtime + one AI Edge Function.

---

## File index

| Area | Primary files |
|------|----------------|
| Shell | `src/App.tsx`, `src/LiquidNavigationBar.tsx`, `src/main.tsx` |
| Auth | `src/AuthScreen.tsx`, `src/authCredentials.ts`, `src/identity.ts`, `src/lib/supabase.ts` |
| Chat | `src/storage.ts`, `src/storeForward.ts`, `src/outbox.ts`, `src/crypto.ts`, `src/ChatHeader.tsx`, `src/ChatSearchPanel.tsx`, `src/ChatRecordButton.tsx` |
| Contacts | `src/contacts.ts`, `src/localContacts.ts`, `src/ContactsSearchPanel.tsx`, `src/EditContactModal.tsx` |
| Groups | `src/groups.ts`, `src/CreateGroupModal.tsx`, `src/GroupManagementModal.tsx`, `src/GroupListRow.tsx` |
| 1:1 calls | `src/p2p.ts`, `src/callSignaling.ts`, `src/callSessions.ts`, `src/CallOverlay.tsx`, `src/IncomingCallModal.tsx`, `src/GuestDirectCall.tsx` |
| Group calls | `src/groupCall.ts`, `src/GroupCallGrid.tsx` |
| Map / gems | `src/GlobeLobby.tsx`, `src/memoryGems.ts`, `src/mapGems.ts`, `src/MemoryGemComposer.tsx`, `src/MemoryGemDrawer.tsx` |
| Trust / safety | `src/trust.ts`, `src/trustSync.ts`, `src/userSafety.ts`, `src/UserActionsPanel.tsx` |
| Profile / theme | `src/ProfileHome.tsx`, `src/ProfileModal.tsx`, `src/themeSpectrum.ts`, `src/ZipLiftSlider.tsx` |
| Settings / i18n | `src/SettingsPanel.tsx`, `src/settings.ts`, `src/i18n/*` |
| Storage | `src/storageManagement.ts`, `src/StorageManagementModal.tsx`, `src/s3Storage.ts` |
| Admin | `src/AdminDashboard.tsx`, `src/AdminPanel.tsx`, `src/admin.ts`, `src/adminModeration.ts` |
| Push | `src/pushNotifications.ts`, `src/notify.ts` |
| Android | `capacitor.config.ts`, `android/app/src/main/AndroidManifest.xml` |
| TURN | `src/p2p.ts` `buildIceServers`, `api/turn.ts` |

---

## How this differs from trusting the Aug 23 audit

The August document is a **control-by-control UI inventory** of an older tree. It does not mention groups, mesh calls, private address book, mute/clear, password reset UI, `AdminPanel` vs dashboard, storage manager, `blocked_users`/`reports`, or Capacitor FCM. It also rates 1:1 calls as a working state machine; **that is no longer accurate on `main`** given the inbox/media split (PR #1).

This file is a **functional** audit: WORKS / PARTIAL / BROKEN / MISSING, with files, backend, and one-line evidence.

---

*Static analysis of `main` @ `f927c93` and PR #1. Runtime still depends on applied SQL, RLS, `VITE_*` secrets, and browser/OS permission (camera, mic, GPS, notifications).*
