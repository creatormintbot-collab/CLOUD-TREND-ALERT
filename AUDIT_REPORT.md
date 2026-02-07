# Audit Report — Cloud Trend Alert

## CRITICAL blockers
- `src/bot/commands.js` `Commands.ensureDmAccess` + command handlers: channel messages were processed (e.g., `/scan`, `/status`), enabling commands inside channels; impact: channels could execute commands and generate signals/positions, violating **Spec #12 (Channel has NO commands)**. Fixed in patch by blocking channel command handling.
- `src/bot/commands.js` `/scan` position creation (DM + group) and `src/lifecycle/bootstrap.js` DM AUTO position creation: positions reused the same base `id` across scopes and group `/scan` positions lacked scope IDs; impact: `PositionsRepo` collisions could overwrite positions across users/groups, causing cross-posted lifecycle/status and breaking isolation; violates **Spec #5 (group isolation)** and **Spec #7 (stable scopeId)**. Fixed in patch by scoping `pos.id` with `scopeId` and adding `scopeId` for group positions.

## HIGH-RISK should-fix
- `src/bot/commands.js` `Commands.ensureDmAccess`: non-allowed groups/channels could still process commands if the bot remained in a chat after allowlist changes (auto-leave only triggers on join); impact: access control not fail-closed; violates **Spec #8 (fail-closed access control)**. Fixed in patch by enforcing `shouldAutoLeave` + restricted message + leave on command reception.
- `src/lifecycle/bootstrap.js` channel AUTO broadcast: entries were sent but no positions created; impact: channels could never receive lifecycle updates (ENTRY HIT / TP / SL) even though allowed; violates **Spec #12 (channel may post lifecycle using existing cards)**. Fixed in patch by creating scoped positions for channel AUTO entries.

## OK / confirmed by reading code
- `src/bot/accessPolicy.js` `parseAllowedIds` and `src/config/env.js` `stripInlineComment`/`list`: inline `#` comments are stripped from allowlists; satisfies **Spec #15**.
- `src/utils/time.js`, `src/storage/quotaRepo.js`, `src/storage/dedupRepo.js`, and UTC day key usage in `src/bot/commands.js` `/scan`/`/status`/`/info`: daily boundaries and dedup/quota keys are UTC-based; satisfies **Spec #6**, **Spec #13**, **Spec #14**.
- `src/bot/scope.js` `resolveScopeIdFromMessage`: stable scope IDs (`u:`, `g:`, `c:`) per chat type; satisfies **Spec #7**.
- `src/bot/commands.js` `/start` + `isSubscribed` flow uses `getChatMember` and provides “Check subscription” button; satisfies **Spec #9**.
- `src/storage/subscriptionsRepo.js` and `src/bot/commands.js` `/tier`, `/grant`, `/revoke`: premium tiering with `expiresAt` and admin-only grant/revoke; satisfies **Spec #10**.
- `src/bot/sender.js` allowlist gating and `src/bot/telegram.js` auto-leave handlers enforce restricted chats; supports **Spec #8**.
