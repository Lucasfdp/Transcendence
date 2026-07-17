# Standard User Management And Authentication Acceptance

## Scope

This document records the acceptance evidence for the **Major: Standard user management and authentication** module defined in `docs/en.subject.md`.

The accepted scope is:

- persistent local registration and sign-in;
- editable public profile information;
- avatar upload, replacement and removal, with the equipped shell as the default portrait;
- friends and live presence;
- an authenticated public profile page for the current player and other players.

Sharing or downloading profile cards is not implemented. Opening profiles from advanced chat, and adding portraits to every compact chat or ranking row, are deliberately outside this module's closure criteria.

## Requirement Mapping

| Requirement | Implementation and evidence |
| --- | --- |
| Users can update profile information | `PATCH /api/users/me` persists turtle name, an owned dojo tag and up to three unlocked showcased achievements. `frontend/src/pages/HomePage.tsx` provides the fixed desktop editor with a live `PlayerProfilePreview`. |
| Users can upload an avatar, with a default avatar when none is provided | `POST /api/users/me/avatar` validates and stores an image in the persistent uploads volume. `DELETE /api/users/me/avatar` removes it. `ShellPortrait` uses the equipped shell whenever the custom URL is absent or fails. |
| Users can add friends and view online status | `backend/src/modules/friends/`, `backend/src/modules/presence/` and the Social modal provide request, acceptance, removal and live `offline`, `online` and `in-game` transitions. |
| Users have a profile page | Protected route `/profile/:username` loads `GET /api/users/:username`, validates the public response, resolves known achievement IDs safely and renders loading, error, empty and populated states independently of the Hub state. |

## Relevant Routes And Endpoints

Frontend routes:

- `/` — authenticated Hub, profile editor and Social controls;
- `/profile/:username` — authenticated public profile page;
- `/auth` — local registration and sign-in;
- `/play/:gameId` — game route used to verify `in-game` presence.

Backend endpoints:

- `POST /api/auth/register`;
- `POST /api/auth/login`;
- `DELETE /api/auth/session`;
- `GET /api/users/:username`;
- `PATCH /api/users/me`;
- `POST /api/users/me/avatar`;
- `DELETE /api/users/me/avatar`;
- `GET /api/friends`, `POST /api/friends/request`, `POST /api/friends/accept`, `DELETE /api/friends/:userId`;
- `GET /api/achievements` and `GET /api/customization` for editor and public-card metadata.

## Automated Validation

Validation date: **17 July 2026**.

| Command or suite | Result |
| --- | --- |
| `cd frontend && npm run test:run` | Passed: 65 files, 368 tests. |
| `cd frontend && npm run build -- --outDir /tmp/opencode/ft-transcendence-profile-production` | Passed: Vite production build, 225 modules transformed. A temporary output directory avoided root-owned `frontend/dist` artefacts. |
| `cd backend && npm run test -- --runInBand` | Passed: 65 suites, 878 tests. Expected error logs belong to tests of failure handling. |
| `cd backend && npm run build` | Passed after restoring the lockfile installation with `npm ci`; no dependency files changed. |
| `git diff --check` | Passed with no whitespace errors. |

Frontend profile coverage includes:

- loading, populated, missing, network-error and invalid-response states;
- equipped-shell fallback;
- absent tag and match history;
- absent and unknown showcased achievement IDs;
- navigation back to the Hub;
- omission of private fields;
- configurable `PlayerProfilePreview` statistics without a public coin value;
- encoded navigation to another player's profile from the link used by Social.

Existing backend coverage includes:

- the strict `PublicUserView` whitelist;
- `NotFoundException` for an unknown username;
- explicit omission of email, password hash, OAuth identifiers, coins, XP, guest metadata and last-seen data;
- avatar URL persistence and fallback restoration;
- authenticated avatar removal;
- profile update validation and rejection of dojo tags not owned by the player through the users/customisation suites.

## Manual Firefox Matrix

The matrix used Firefox 152.0.4 with geckodriver 0.36.0, two independent browser sessions and two newly registered persistent local accounts. No credentials, cookies or tokens were written to the repository or this document.

### Authentication

| Check | Concrete result |
| --- | --- |
| Register accounts A and B | Both local email/password registrations completed and reached the authenticated Hub. |
| Log out and sign in again | A logged out, returned to `/auth`, and signed in again with the original local credentials. |
| Reject incorrect credentials | A deliberately used an incorrect password and received `Invalid email, username or password.` without creating a session. |
| Sensitive-data check | The public endpoint and both public profile UIs omitted email, password/authentication data and balances. |

### Profile And Editor

| Check | Concrete result |
| --- | --- |
| Change identity | A changed the turtle name to a distinct acceptance value and selected the unlocked `Shell First` dojo tag. |
| Change all showcase slots | Three unlocked achievements were selected through the three independent horizontal selectors and saved. |
| Live preview and layout | The card heading updated while typing. Connected accounts were visible. The 1440×1000 modal body had no overflow; all three selectors shared one row, and measured dropdown rows did not overlap. |
| Reload and direct route | `/profile/:username` loaded directly and after browser refresh without prior `HomePage` state. The saved name, tag and all three achievement titles remained visible. |
| Public profile contents | Level, shell/avatar, online state, matches, wins, losses, dojo tag, achievement showcase and the no-match/most-played presentation were available without private values. |
| Other player's profile | A opened B from Social using the separate `View profile` action. B's public page contained no email, authentication method or balance. |
| Mobile landscape | Firefox at 844×390 rendered the public profile with the back link and shell fallback visible. Document and body widths were both 832 px against an 832 px viewport, with no horizontal overflow. The existing portrait-orientation guard remains unchanged. |

### Avatar

| Check | Concrete result |
| --- | --- |
| Default portrait | Before upload, the editor rendered the equipped shell through `ShellPortrait`. |
| Upload and propagation | A valid WebP upload appeared in the editor, Hub header, public profile and Social hover profile. |
| Replacement | A valid JPEG replaced the WebP and the replacement remained the active avatar. |
| Validation failures | A non-image file and a PNG larger than 2 MiB were both rejected with the documented size/type message. |
| Browser reload | The uploaded image remained visible after direct-route reload. |
| Container rebuild | After the corrected `make re`, the profile still referenced the replacement and fetching its `/api/uploads/avatars/...` URL returned HTTP 200. |
| Removal | `Use equipped shell` removed the custom portrait. The editor and public profile immediately returned to the shell fallback. |

### Friends And Presence

| Check | Concrete result |
| --- | --- |
| Request and acceptance | A sent a request to B from Social; B accepted it in the second browser. Both friend lists then contained the other account. |
| `offline → online` | After B signed back in, A's already-open Social list changed to online without a page reload. |
| `online → in-game` | A invited B to a private Temple Curling match. Both accepted/entered the game, and A's Social list then labelled B as playing Temple Curling. |
| `in-game → online` | B abandoned the active match. A's open Social list changed back to online without reload. |
| `online → offline` | B logged out. A's open Social list changed to `Last online ...` without reload. |
| Removal | A removed B; after the undo window elapsed, B disappeared from A's list and the live removal event removed A from B's open Social list. |
| Profile navigation | A opened B's `/profile/:username` page from the friend-row `View profile` link. |

## Persistence And Docker

The acceptance run exposed that the former `make re` target depended on `fclean` and therefore deleted `db_data`, `uploads_data` and every other named volume. This contradicted the documented `down` then `up` behaviour and made persistence impossible to defend.

`make re` now depends on `down up`. It still rebuilds images and recreates every container, but only `make fclean` uses `-v` and destroys persistent data.

After this correction:

- the same local account remained queryable after `make re`;
- turtle name, tag and all three showcased achievement IDs remained persisted;
- the replacement avatar URL remained present and returned HTTP 200;
- all Compose services reached `healthy` status;
- `make health` reported every service healthy, including reverse proxy, frontend, backend, database, Redis, Vault, monitoring and both exporters.

## Public Profile Privacy

`GET /api/users/:username` returns an explicit `PublicUserView`; it never serialises the `User` entity directly. The public page also validates the response shape and renders only:

- user ID and username identity;
- turtle name, shell skin, avatar and level;
- coarse online state;
- aggregate public match statistics and most-played game;
- dojo tag and showcased achievement IDs.

The response and UI exclude email, password hashes, OAuth identities, coins, accumulated coin totals, XP, administrative flags, moderation data and antifraud records. Public profiles use losses as the third card statistic rather than forcing `totalCoinsEarned` into a public component contract.

## Deliberate Limitations

- Profile-card sharing and downloading are not implemented.
- Chat does not link to profiles; that belongs to the optional advanced-chat module.
- Compact chat and ranking rows are not required to use `ShellPortrait` for this module.
- The application-wide portrait-orientation guard remains in place; the public profile was validated in mobile landscape.
- Firefox emitted browser-internal Nimbus, LoginRecipes and destroyed-document diagnostics in geckodriver output. A clean post-restart profile run contained no application-origin console error or failed application request. Errors captured during the forced container downtime were expected transport interruption, not steady-state failures.
