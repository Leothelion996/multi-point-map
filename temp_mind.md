## CURRENTLY WORKING ON
- Current evaluation target: final consolidation and severity ordering across `server.js`, `db/database.js`, `middleware/deviceId.js`, `script.js`
- Current hypothesis: primary risk is data-integrity failure from transaction/callback defects plus exposed static artifacts and stale frontend API paths
- Pending validation steps: none (line-anchored checks complete)
- Files or functions referenced but not yet validated: Dependency Assumption - Not Verifiable (`MapZipCodes/*` payload size/runtime characteristics in production)

## CONFIRMED ISSUES
1) Location: `db/database.js` `updateLocationGroup` callback (~346-356)
- Why: uses arrow callback with `this.changes`; `this` is class instance, not sqlite statement.
- Impact: High
- Type: Bug

2) Location: `db/database.js` `replaceLocationsInGroup` -> `addLocationsToGroup` (~596-611 and ~530-576)
- Why: starts transaction then calls method that starts another transaction on same connection.
- Impact: Critical
- Type: Bug

3) Location: `db/database.js` `reorderLocations` (~647-692)
- Why: empty `locationIds` causes `BEGIN` without any path to `COMMIT`/`ROLLBACK`.
- Impact: High
- Type: Bug

4) Location: `db/database.js` schema/init (~45-74; no PRAGMA foreign_keys)
- Why: foreign keys declared but enforcement not enabled in sqlite session.
- Impact: Critical
- Type: Architecture

5) Location: `db/database.js` `registerDevice` (~186-187)
- Why: `INSERT OR REPLACE` on PK rewrites row, resetting `created_at` semantics.
- Impact: Medium
- Type: Bug

6) Location: `server.js` static hosting (~109)
- Why: serves project root; exposes non-public artifacts (source, docs, potential `/data/*.db`).
- Impact: Critical
- Type: Security

7) Location: `server.js` `/api/config` (~137-151)
- Why: accepts missing referrer and returns API key; referrer check is bypassable outside browser.
- Impact: High
- Type: Security

8) Location: `script.js` APIService endpoints + usages (~159-212, ~880, ~1048)
- Why: service points to legacy `/api/location-groups/*`; active backend is `/api/:groupType/groups/*`. live calls to `apiService.updateLocation` will fail.
- Impact: High
- Type: Bug

9) Location: `script.js` `deleteLocationFromGroup` (~459-467)
- Why: ignores non-2xx responses; UI state mutates as if delete succeeded.
- Impact: Medium
- Type: Bug

10) Location: `server.js` ZIP centroid calc (~188-205)
- Why: division by zero if geometry type unsupported/empty coordinates.
- Impact: Medium
- Type: Bug

## POTENTIAL RISKS
1) Location: `server.js` ZIP bootstrap cache (~22-53)
- Why: full national geometry loaded in-process; startup latency and RSS growth scale with dataset.
- Impact: High
- Type: Scaling

2) Location: `db/database.js` `getLocationGroups` (~214-236)
- Why: N+1 query pattern (group list + per-group locations) degrades with group count.
- Impact: High
- Type: Scaling

3) Location: `middleware/deviceId.js` logging (~21,26,36,47,54)
- Why: persistent identifiers logged at info level; privacy/observability noise risk.
- Impact: Medium
- Type: Security

4) Location: `server.js` CORS production placeholder (~67,140)
- Why: hardcoded placeholder domain likely misconfigured in deployment.
- Impact: Medium
- Type: Architecture

## ARCHITECTURAL WEAKNESSES
- Stateful identity and ownership model bound to unsigned client cookie only; no auth boundary beyond possession of cookie value.
- Static and API concerns share same root surface; no hardened public asset boundary.
- DB service couples transaction control with methods that may be composed recursively (no transaction context propagation).
- Frontend contains dual API abstraction models (`API_BASE` + stale `APIService`), creating protocol drift.

## SCALING BOTTLENECKS
- In-memory ZIP geometry cache with whole-country footprint on single node.
- N+1 group loading queries in `getLocationGroups`.
- Reorder implementation issues O(n) single-row updates per request without batch SQL.

## REFACTOR OPPORTUNITIES
- Replace callback-heavy sqlite flow with promise-wrapped transaction helper that enforces single transaction scope and explicit statement metadata handling.
- Split public static directory (`public/`) from server/runtime/data directories.
- Consolidate frontend network access behind one typed endpoint builder keyed by `groupType`.
- Introduce ownership checks that include `group_type` on location mutations to enforce route/model consistency.
