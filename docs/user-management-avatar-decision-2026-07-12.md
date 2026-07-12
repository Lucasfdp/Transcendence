# User Management Module — Status Report & Avatar Decision

Date: 2026-07-12
Module: **Major — Standard user management and authentication** (`docs/en.subject.md` §IV.3)
Current status in `docs/modules-progress.md`: `In progress`
Current status in `docs/modules.md`: `pending`

---

## 1. Purpose of this document

Customisable turtle avatars have been cut from scope (too much work). This report analyses what the module actually requires, what already exists in the codebase, what is broken, and lays out three implementation routes so the team can pick one. **Section 6 is the decision section — read at least that.**

---

## 2. What the subject requires

From `docs/en.subject.md`, lines 335–339:

> **Major:** Standard user management and authentication.
> - Users can update profile information.
> - Users can upload an avatar, with a default avatar when none is provided.
> - Users can add friends and view online status.
> - Users have a profile page.

⚠️ **Key constraint: avatar upload cannot be cut.** The subject bullet is explicit — *upload* an avatar, with a *default* when none is provided. Dropping avatars entirely means this major cannot be claimed.

**However:** what was cut ("customisable turtle avatar" — the WIP notice in the Edit Profile modal) is *not* what the subject asks for. The subject needs a plain image upload + default fallback. We are much closer to that than the progress doc suggests.

---

## 3. Requirement-by-requirement audit

| Requirement | State | Evidence |
|---|---|---|
| Update profile | ✅ Done | `PATCH /api/users/me` (`users.controller.ts`), Edit Profile modal in `HomePage.tsx` (turtle name, dojo tag, achievement showcase) |
| Friends + online status | ✅ Done | `friends` + `presence` modules; already validated under the "interact with other users" major (full Jest coverage, live presence push) |
| Profile page | ✅ Effectively done | Hover/focus `ProfileCard` (`frontend/src/features/social/profileCard/`) + whitelisted `GET /api/users/:username` public view |
| Avatar upload + default | ⚠️ Backend ~90 %, delivery 0 %, frontend 0 % | Detail below |

### 3.1 Avatar — what exists

- `POST /api/users/me/avatar` in `users.controller.ts` is solid: multer disk storage, MIME whitelist (JPEG/PNG/WebP/GIF), 2 MB limit, UUID filenames.
- `users.service.ts::updateAvatar` persists the URL to `users.avatar`.
- The `avatar` field already flows through **every** relevant API response and frontend type: `/users/me`, `/users/:username`, leaderboard, `FriendView`, `PendingView`, chat conversation views (`frontend/src/features/hub/api.ts`).
- `api.uploadAvatar()` exists in the frontend API layer **and is unit-tested** (`api.test.ts`) — it is just never called.
- The public API even exposes `DELETE /api/public/users/:username/avatar`.

### 3.2 Avatar — what is broken or missing

1. **Delivery pipeline is dead.** The controller comment claims "Nginx serves /uploads/ as a static directory" — **it does not.** There is no `location /uploads/` in `infra/reverse-proxy/conf/default.conf.template`, no static-serve in the backend, and no `uploads` volume in `docker-compose.yml`. Consequences:
   - The returned URL `/uploads/avatars/<uuid>.png` routes to the frontend container → **404**.
   - Files land inside the backend container's ephemeral filesystem → **lost on every rebuild**.
2. **Zero upload UI.** The Edit Profile modal shows a `WorkInProgressNotice` ("Customisable turtle coming soon", `HomePage.tsx` ~line 3334) instead of an upload control.
3. **Avatars render nowhere.** No `<img>` in the app displays `avatar` — friends list, leaderboard, profile card, chat all ignore the field they already receive.
4. **No default avatar.** `users.avatar` is nullable with no default; no fallback asset or helper exists.
5. **Docs out of date.** `docs/modules.md` line 13 still says `pending`; `docs/modules-progress.md` says `In progress`.

---

## 4. The three routes

All routes assume the cut stands: no turtle customisation, no crop/resize UI, no cosmetic avatar system.

### Route A — Minimum viable claim
**~120–180 lines · ~6 files · ~half a day**

- **Delivery fix (zero nginx changes):** serve `./uploads` via `app.useStaticAssets()` in `main.ts` under the `/api/uploads/` prefix — nginx already proxies `/api/` to the backend. Change `updateAvatar` to return `/api/uploads/avatars/...`. Add one `uploads_data` volume to `docker-compose.yml` for persistence.
- **Frontend:** replace the WIP notice in Edit Profile with current-avatar `<img>` + file input wired to the existing `api.uploadAvatar()`.
- **Default:** one static asset (`frontend/public/avatars/default.png`, e.g. reuse a turtle sprite) + a small `avatarUrl(avatar: string | null)` helper with fallback. Render in Edit Profile and the hub header.
- Update `docs/modules-progress.md` + `docs/modules.md` + fix the stale nginx comment in `users.controller.ts`.

*Risk:* an evaluator checking "default avatar when none is provided" will look at a fresh account in the friends list or leaderboard. If avatars only appear in the Edit Profile modal, the claim looks half-true.

### Route B — Eval-proof (recommended)
**~300–400 lines · ~12 files · 1–2 days**

Everything in Route A, plus:

- **Render avatars where the data already flows:** friends list, pending requests, DM/conversation headers, leaderboard rows, `ProfileCard`. No API changes — every view type already carries `avatar`; this is JSX + CSS only.
- **Security/hygiene hardening:**
  - Magic-byte validation on upload — multer's `fileFilter` currently trusts the client-supplied MIME type, which is trivially spoofable. Relevant because the upload endpoint sits behind our claimed WAF/Vault cybersecurity major.
  - Unlink the previous avatar file on replace (currently orphans would accumulate in the volume).
  - "Remove avatar" button → `DELETE /api/users/me/avatar` (mirrors the existing public-API endpoint), resets to default.
- **Tests:** Jest specs for upload/updateAvatar (happy path, oversized, bad MIME, missing file, remove) targeting the standard ≥80 % on the new logic; vitest for the `avatarUrl` fallback helper.

### Route C — Full polish (already cut — listed for completeness)
**600+ lines · 3+ days**

Crop/resize UI, server-side image normalisation (sharp), preset/turtle avatar picker, dedicated profile page route. **None of this is required by the subject.** This is the work that was cut, and cutting it is correct.

---

## 5. Comparison at a glance

| | Route A | Route B | Route C |
|---|---|---|---|
| Effort | ~½ day | 1–2 days | 3+ days |
| Code volume | ~150 lines | ~350 lines | 600+ |
| Subject bullet satisfied | Yes (technically) | Yes (robustly) | Yes (overkill) |
| Default avatar visible to evaluator | Edit Profile + header only | Everywhere users appear | Everywhere |
| Upload security | Client-MIME only | Magic-byte validated | Magic-byte + normalised |
| Orphaned files on volume | Yes | No | No |
| New tests | None required | Upload specs + helper tests | Extensive |
| Eval risk | Medium — thin surface | Low | Low |

---

## 6. Decision needed from the team

**Pick one route.** Recommendation: **Route B.**

Rationale: Route A gets the checkbox but presents a thin surface at evaluation — the default avatar is barely visible and the upload endpoint keeps two real weaknesses (spoofable MIME, orphaned files) that clash with the cybersecurity major we're also claiming. Route B's extra cost over A is mostly repetitive JSX; the marginal day buys a module we can defend confidently instead of nervously.

Questions to settle when choosing:

1. **Route: A, B, or C?**
2. **Default avatar asset** — reuse an existing turtle sprite from `public/`, or make a dedicated one?
3. **If Route B:** is "remove avatar" in scope, or is replace-only acceptable? (Small; recommend keeping it.)
4. **Who takes it?** The frontend work is the bulk (rendering sites); backend delivery fix is ~1 hour.
5. **GIF avatars** — the MIME whitelist currently allows animated GIFs. Keep or restrict to static formats? (Keep = zero work; restrict = one-line change.)

Once decided, the implementing task must also update `docs/modules-progress.md` and flip `docs/modules.md` line 13 from `pending` (per `CLAUDE.md` rules), and correct the false nginx comment in `users.controller.ts`.

---

## 7. Out of scope regardless of route

- Turtle avatar customisation (cut — the `WorkInProgressNotice` gets removed by whichever route is chosen).
- Any change to friends, presence, profile editing, or the profile card beyond adding the avatar image — those requirement bullets are already satisfied.
- 2FA, permissions, organisations — separate modules, not selected in `docs/modules-progress.md`.
