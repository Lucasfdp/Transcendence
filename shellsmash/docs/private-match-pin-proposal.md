# Private Match PIN Proposal

## Decision

Do not implement private matches by PIN in the same iteration as matchmaking cancellation and reconnection blocking.

## Why

The current matchmaking model is a FIFO queue keyed by `gameId`, `mode`, and `playerCount`. A private match needs a different lifecycle: create a pending room, generate a short code, allow direct joins by code, expire unused rooms, and handle creator cancellation/disconnects.

Adding that into the existing queue path would mix two concepts and increase regression risk for public matchmaking.

## Suggested Shape

- Add a `privateRooms` store on the backend keyed by a 4-6 character PIN.
- Creator emits `private:create` with `gameId`, `mode`, `playerCount`, and shell selection.
- Backend emits `private:created` with the PIN and expiration timestamp.
- Guests emit `private:join` with the PIN and their shell selection.
- When the room reaches `playerCount`, reuse `RoomService.createRoom()` and the existing `match:found` / `room:ready` flow.
- Add `private:leave` and automatic expiration for stale private rooms.

## Acceptance Criteria For Later

- PINs are unique while active and expire automatically.
- Leaving/cancelling a private lobby cleans up all participants.
- Public queue and private rooms cannot contain the same user at the same time.
- Existing reconnection blocking applies after the private match starts.
