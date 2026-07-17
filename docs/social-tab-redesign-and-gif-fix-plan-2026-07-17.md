# Social Tab Redesign + GIF Fix — Implementation Handoff

> **Status:** IMPLEMENTED, pending manual verification — all three workstreams (A, B, C) were
> implemented 2026-07-17. Backend Jest (all 65 spec files, including new `gif.service.spec.ts`
> cases) and `tsc --noEmit` (backend + frontend, filtered to touched files) are clean. What's
> still open, per §6: a fresh manual two-account pass (GIF search/send/render, tab switching
> with a thread open, requests badge, mini avatars incl. fallbacks, mobile ≤1100px layout +
> back button, block/report/invite from the Friends tab) and a `cd frontend && npm run test:run`
> run — both require the user's Mac; the sandbox can't run either. `docs/modules-progress.md`
> was updated in the same task as the implementation.
>
> Written 2026-07-17 after a code review of the social tab, the chat/GIF pipeline, and the
> replay page (used as the layout reference). All product decisions below were confirmed with
> Lucas on 2026-07-17 — do not re-litigate them.
>
> Once the manual pass above is done and any findings are resolved, move this file to
> `docs/old_docs/` per `CLAUDE.md`.

---

## 1. Scope and locked decisions

Three workstreams, in priority order:

1. **Fix GIFs** (currently broken — search always returns "No gifs found").
2. **Bug fixes / edge-case hardening** from the review in §4.
3. **Redesign the Social modal layout** to a two-pane layout mirroring the replay page:
   list on the left, chat thread on the right, plus mini avatars on friend rows.

**Decisions confirmed with the user (2026-07-17):**

- Left pane is organized as **tabs: `Friends | Chats | Requests`** — same visual pattern as the
  replay page's `Match replays / My replays` tabs (`.hub-modal__replay-tab`).
- **Requests tab** holds pending requests, outgoing requests, suggestions ("People you may know"),
  and blocked users. The **add-friend input + friend code stay pinned at the top of the left pane**
  (visible on every tab). Show a **badge count** on the Requests tab when pending requests > 0.
- **Mini avatars appear on friend rows only** (not conversation rows, not per-message, not request
  rows). Use the existing `ShellPortrait` component with the presence indicator overlaid on the
  portrait corner.
- GIF symptom as observed by the user: **search always shows "No gifs found"** — see §3 for the
  ordered root-cause verification.

**Out of scope:** anything not listed here. `docs/modules-progress.md` bounds the project scope.
No new runtime dependencies (see §2 — npm installs can't run in the sandbox anyway).

---

## 2. Environment constraints (read before starting)

`docs/SOCIAL_TAB_HANDOFF.md` §2–3 documents these in full; the short version:

- The sandbox **cannot `npm install`** (registry blocked) and **cannot run vitest**
  (macOS-native binaries in `node_modules`). Frontend vitest runs must be executed by the user
  on their Mac: `cd frontend && npm run test:run`.
- **Backend Jest runs fine in-sandbox**: `cd backend && npm run test`.
- **`tsc --noEmit` runs in-sandbox for both** — type-check every change; filter output to your
  files (pre-existing errors exist).
- The Social modal lives inside `frontend/src/pages/HomePage.tsx` (~5090 lines). Respect the
  existing style: tabs (width 4) per `.prettierrc.json`, existing naming conventions.
- Manual validation of `HomePage.tsx` UI changes must be documented in the handoff (no test
  runner covers it) — per `CLAUDE.md` Testing rules.

---

## 3. Workstream A — GIFs broken

### Symptom

GIF picker search always shows "No gifs found", for every query.

### Root-cause analysis (verify in this order)

**A1. `KLIPY_APP_KEY` may be empty (most consistent with the symptom).**
`scripts/vault-seed-dev.sh` seeds `KLIPY_APP_KEY=` **empty by default** (line ~74). If the user
never filled it in, `GifService.buildUrl()` throws 500 "GIF search is not configured" on every
search — and the frontend **swallows the error silently** (`runGifSearch` catch at
`HomePage.tsx:1851` sets `gifResults([])`), which renders as "No gifs found". A missing key is
indistinguishable from a genuine empty result, both server-side and client-side.

*Verify:* ask the user to check the seed file used by `make vault-seed-dev` for a non-empty
`KLIPY_APP_KEY`, or hit `GET /api/chat/gifs/search?q=cat` while authenticated and look at the
status code, or `make logs SERVICE=backend` while searching. If empty: user obtains a key from
klipy.com, fills the seed file, reruns `make vault-seed-dev`, restarts backend.

**A2. Media-host allowlist rejects 2 of Klipy's 3 CDN hosts.**
Klipy's official Network Requirements (https://docs.klipy.com/network-requirements) lists **three**
media-delivery domains: `static.klipy.com`, `static1.klipy.com`, `static2.klipy.com`.
`backend/src/modules/chat/gif.service.ts:24` trusts only `static.klipy.com`
(`KLIPY_MEDIA_HOSTNAME`), and `toSearchResult()` silently drops any item whose URLs are on the
other hosts. If Klipy load-balances most media onto `static1`/`static2`, **all 24 results of a
page can be filtered out** → "No gifs found" even with a valid key. It also breaks sends:
`getBySlug()` throws "GIF provider returned an unexpected format" for a static1/2-hosted item.

*Fix* in `gif.service.ts` — replace the single hostname with a set:

```ts
/** The only hosts we will ever persist or broadcast a gif/preview URL for
 *  (Klipy's documented media-delivery domains — docs.klipy.com/network-requirements). */
const KLIPY_MEDIA_HOSTNAMES: ReadonlySet<string> = new Set([
	"static.klipy.com",
	"static1.klipy.com",
	"static2.klipy.com",
]);

private isTrustedHost(url: string): boolean {
	try {
		return KLIPY_MEDIA_HOSTNAMES.has(new URL(url).hostname);
	} catch {
		return false;
	}
}
```

Keep exact-hostname matching (no suffix/wildcard matching — a suffix check like
`endsWith("klipy.com")` would trust `evilklipy.com`-style lookalikes and any future compromised
subdomain; the set is the safe shape).

**A3. CSP `img-src` only allows one of the three hosts.**
`infra/reverse-proxy/conf/default.conf.template:28` — `img-src` allows only
`https://static.klipy.com`. Even after A2, the browser would block images served from
`static1`/`static2` (gif messages would arrive but render as broken images). Add both hosts:

```
img-src 'self' data: blob: https://static.klipy.com https://static1.klipy.com https://static2.klipy.com;
```

Also update the explanatory comment on line 26. Requires `make rebuild-front`-style proxy restart
(`make restart` or rebuild of `reverse_proxy`) to take effect.

### A4. Make failure states distinguishable (hardening, do alongside)

- **Backend:** when `KLIPY_APP_KEY` is missing, throw `ServiceUnavailableException` (503) instead
  of the generic 500, so an operator can tell "unconfigured" from "Klipy is down" in logs/monitoring.
- **Frontend:** `runGifSearch`'s catch currently produces the same UI as zero results. Add a
  `gifSearchError: boolean` state; on catch set it and render
  "GIF search is unavailable right now." instead of "No gifs found." Clear it on the next search,
  picker toggle, and conversation open/close (same places `gifResults` is reset).
- Preserve the existing sequence-guard semantics (`gifSearchSeq`, Bug Audit L3) exactly.

### A5. Optional polish (small, include if time allows)

- Klipy has a trending endpoint (`gifs/trending`, same response shape as search). Populating the
  picker with trending gifs on open would replace the current blank "Type to search for gifs."
  state. Same proxy pattern, same host filtering, same tests.
- Check Klipy's attribution guidelines (https://docs.klipy.com/attribution) — a "Powered by KLIPY"
  notice in the picker may be required by their ToS; add a small footer line in the picker if so.

### Tests (backend Jest — runnable in-sandbox)

Extend the existing `gif.service` spec (or create one following the module's spec conventions):

- `search()` keeps items hosted on each of the three allowed hosts.
- `search()` drops an item hosted on an unlisted host (e.g. `evil.example.com`) and on a
  lookalike (`static.klipy.com.evil.com`, `notstatic.klipy.com`).
- `getBySlug()` succeeds for a `static1.klipy.com` item (regression for the send failure).
- Missing `KLIPY_APP_KEY` → `ServiceUnavailableException`.
- Malformed URL in item → filtered, no throw.

---

## 4. Workstream B — bugs and edge cases found in review

Listed roughly by user impact. The social/chat code has already been through several audits
(`docs/social-page-bug-audit-2026-07-07.md`, Bug B1–B8, L1–L6 comments) — **do not regress those
behaviours**; §6 lists the invariants.

**B1. Raw API error text is shown to users.**
The screenshot of the replay page shows a red "Unauthorized" — that's
`setModalError(err.message)` at `HomePage.tsx:2085` (`openReplays`) surfacing the raw HTTP error.
Same pattern at lines 1599 and 1616 (avatar upload/reset). A 401 mid-session should trigger the
session-expired/re-auth path (or at minimum friendly copy: "Your session has expired — please log
in again."), never the raw string. Sweep `setModalError(err instanceof Error ? err.message : …)`
call sites and route 401s to a shared handler; keep specific messages for 4xx validation errors
that are already user-worded.

**B2. GIF search failure indistinguishable from empty results.** Covered by A4.

**B3. `friend:removed` triggers a full `refreshSocial()` even when the Social modal is closed**
(`HomePage.tsx:932`). `refreshSocial` refetches friends + pending + outgoing (+ more) — several
requests fired for a modal the user isn't looking at, and a burst of removals stampedes it (no
in-flight guard, unlike the conversation refetch's `conversationRefetchInFlightRef`). Fix: no-op
when `friends === null` (modal never opened), and add an in-flight guard mirroring Bug B4's.

**B4. New-group creation with zero friends renders an empty "Add friends:" list** with a disabled
Create button and no explanation (`HomePage.tsx:3855`). Add an empty state: "Add some friends
first — groups are friends-only."

**B5. Group rename draft can open stale.** `setGroupRenameDraft(activeConversation?.name ?? "")`
seeds from the conversation list; if a `chat:conversation-updated` rename lands while the rename
form is open, the draft silently diverges from the new name. Low impact — acceptable to just
document; if fixing, close/refresh the draft on `chat:conversation-updated` for the open
conversation.

**B6. GIF picker open state survives thread switches correctly, but the composer draft does not
survive tab/pane switches in the new layout** — when implementing §5, make sure switching left-pane
tabs does *not* unmount the open thread state (draft, scroll position). Keep the thread mounted on
the right; tabs only swap the left pane's list.

**B7. Klipy attribution** — see A5; compliance check, not a code bug.

---

## 5. Workstream C — Social modal layout redesign

### Reference pattern (already in the codebase)

The replay modal: grid container `.hub-modal__replays` (`global.css:5248`) —
`grid-template-columns: minmax(18rem, 0.92fr) minmax(24rem, 1.08fr)`, left pane scrolls
internally, right pane has `border-left` + `padding-left`, and the whole thing collapses to a
single column at `@media (max-width: 1100px)` (`global.css:5487`). The modal body override
`.hub-modal__panel--wide .hub-modal__body:has(.hub-modal__replays) { overflow: hidden; }`
(`global.css:2392`) makes the panes own their scrolling. The tab buttons are
`.hub-modal__replay-tab` / `--active` (`global.css:5292`). The right pane's empty state is the
game logo + "Select a replay to inspect its timeline."

### Target structure

Rendered inside the existing `activeModal === "social"` branch of `HomePage.tsx` (~line 3786),
inside the existing `<HubModal title="Social" variant="wide">`:

```
.hub-modal__social                        ← new 2-col grid, clone of .hub-modal__replays
├── .hub-modal__social-sidebar            ← LEFT: scrolls internally
│   ├── (pinned) friend code + copy      ← existing .hub-modal__social-code
│   ├── (pinned) add-friend input+button ← existing .hub-modal__social-add
│   ├── (pinned) tab strip: Friends | Chats | Requests[·N]
│   └── (scrolling) active tab content:
│       ├── Friends: search input + In game / Online / Offline groups (existing friendRow,
│       │            now with mini avatar) + inline invite picker + report panel
│       ├── Chats:   "New group" button + group-creation form + conversation list
│       │            (existing rows, unread dot, preview)
│       └── Requests: Pending / Outgoing / People you may know / Blocked users sections
└── .hub-modal__social-main               ← RIGHT: chat thread
    ├── empty state: Shell Smash logo + "Select a conversation to start chatting."
    │   (mirror .hub-modal__replay-empty / .hub-modal__replay-empty-logo)
    └── open thread: existing thread header (minus "← Back" on desktop), rename form,
        members panel, message list, gif picker, composer — markup moves, logic unchanged
```

### Implementation notes

- **State:** add one new piece of UI state: `socialTab: "friends" | "chats" | "requests"`
  (default `"friends"`). `activeConversationId` no longer gates *which* list renders — it only
  controls the right pane. **Reset `socialTab` in `openSocial()`** alongside the other resets.
- **Behavioral rewires** (all existing handlers stay as-is):
  - `handleStartDirectMessage` / opening a conversation: keep the left pane on its current tab
    (or switch to Chats — implementer's choice, but be consistent); thread opens on the right.
  - `handleCloseConversation`: right pane returns to the empty state. On mobile (≤1100px,
    single column) keep the "← Back" button to return from thread to lists; on desktop hide it
    (the lists are always visible).
  - The "New group" button/form moves into the Chats tab; it must no longer be gated on
    `!activeConversationId` (a thread being open on the right shouldn't block group creation).
  - Requests tab badge: `pendingRequests?.length ?? 0`, hidden when 0.
  - Blocked users: there is an existing "Blocked users" section (per `modules-progress.md` §63)
    — move it into the Requests tab with the others.
- **Mini avatars (friend rows only):** render `ShellPortrait`
  (`frontend/src/features/profile/ShellPortrait.tsx`) at the start of `friendRow`:
  `<ShellPortrait avatar={friend.avatar} shellSkin={friend.shellSkin} displayName={friend.turtleName ?? friend.username} size="small" />`
  — omit `level` to suppress the level chip. `--small` is 3.4rem (`global.css:8500`); that's
  likely too large for a dense list row, so add a `shell-portrait--mini` size (~2.2rem) in
  `global.css` and extend the `ShellPortraitSize` type. `FriendView.avatar` already exists —
  **no backend or API changes needed.** Overlay the existing presence dot
  (`.hub-modal__presence-dot` / online/in-game variants) on the portrait's bottom-right corner;
  keep the textual "Last online …" / game label beside the name as today. `ShellPortrait`
  already handles null avatars (shell-skin fallback) and broken images (`onError` fallback) —
  don't duplicate that logic.
- **CSS:** clone the replay grid/pane/tab rules under new `social-` names rather than reusing
  `replay-` class names — the two features must be independently tunable. Reuse the exact same
  breakpoint (1100px) and the `:has()` body-overflow override pattern
  (`.hub-modal__panel--wide .hub-modal__body:has(.hub-modal__social)`).
- **Do not extract components mid-task.** The modal stays in `HomePage.tsx` like everything else
  there; this task is a re-layout, not a refactor of the 5k-line file.

### What must keep working (regression checklist for the move)

The thread JSX being relocated carries hard-won behaviours — moving markup must not touch logic:

- Scroll anchoring: open-at-bottom, preserve-on-prepend, stick-to-bottom threshold (Bug B2;
  `chatScrollActionRef`, `useLayoutEffect` at `HomePage.tsx:1040`).
- Message dedup vs. live echo + history race (L1), id-cursor pagination (B6), stale-fetch
  sequence guards (B5) in `handleOpenConversation`.
- Draft restore on `chat:error` (B8), IME Enter guard (L4) on both composer and add-friend inputs.
- Unread dot add/remove flows (`chat:read` emit on open, `chat:unread`, `chat:read-sync`).
- Group owner controls, `chat:removed` / `chat:conversation-updated` live patches.
- ProfileCard hover on friend names (debounced), block-confirm two-step, report=report+block flow,
  invite picker gating (`friend.isOnline && !activeLobby`).

---

## 6. Verification and housekeeping

1. `cd backend && npm run test` (in-sandbox) — all suites green, including new gif.service specs.
2. `tsc --noEmit` for frontend and backend (in-sandbox), filtered to touched files.
3. Frontend vitest (`npm run test:run`) run by the user on their Mac if any pure helper under
   `frontend/src/features/{chat,social}` changes.
4. Manual validation with two accounts, documented in the completion note: GIF search + send +
   render both directions; tab switching with a thread open (draft survives); requests badge;
   mini avatars incl. no-avatar fallback and broken-image fallback; mobile ≤1100px single-column
   + Back button; block/report/invite flows from the new Friends tab.
5. Update `docs/modules-progress.md` if this completes/advances module items (it touches the
   chat + user-management/avatar lines).
6. Move this document to `docs/old_docs/` when everything above is closed.
