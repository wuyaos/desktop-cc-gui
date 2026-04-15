# Sidebar Cache Design

## Summary

Add a persisted sidebar snapshot so the app can show the last known `workspaces` and per-workspace thread summaries immediately on startup, while still issuing live refresh requests in the background and replacing the snapshot with fresh data when those requests complete.

This design only covers the sidebar surface:

- Workspace list
- Per-workspace thread summary lists

It explicitly does not cache:

- Thread message history
- Thread detail payloads
- Conversation items

## Problem

The sidebar currently depends on in-memory state populated after startup by `listWorkspaces()` and `listThreadsForWorkspace()`. When the window is reopened, the user sees loading skeletons even if the exact same data was successfully loaded in the previous session.

That makes startup feel slower than necessary.

At the same time, the sidebar must not become stale just because a cache exists. If the user created or updated sessions from the CLI, the app still needs to request live data immediately and update the sidebar once the backend responds.

## Goals

- Show the last known sidebar state immediately on app startup.
- Keep the existing live refresh behavior.
- Let live data replace cached data as soon as requests complete.
- Avoid any cache behavior that blocks new CLI-created sessions from appearing.
- Keep the change scoped to sidebar summaries only.
- Reuse the existing client store persistence layer.

## Non-Goals

- Offline-first thread history
- Message detail caching
- Backend protocol changes for dedicated sidebar snapshot APIs
- Sidebar UI redesign
- Changes to thread detail rendering semantics

## Recommended Approach

Use the existing `clientStore` persistence layer and store a versioned sidebar snapshot in the `threads` store.

On startup:

1. Hydrate cached `workspaces`
2. Hydrate cached `threadsByWorkspace`
3. Render the sidebar from that snapshot immediately
4. Trigger the normal live `refreshWorkspaces()` and `listThreadsForWorkspace()` flow
5. Replace state with fresh results when they arrive
6. Persist the fresh results back into the snapshot

This is effectively a stale-while-revalidate model for sidebar summaries.

## Why This Approach

### Option A: Persisted sidebar snapshot in `clientStore` (recommended)

Pros:

- Solves the actual startup problem across app restarts
- Reuses an existing persistence path
- Keeps the cache fully client-side and low-risk
- Fits the desired "show cache first, then refresh" behavior directly

Cons:

- Requires a small amount of versioning and validation logic

### Option B: In-memory-only cache

Pros:

- Very small implementation

Cons:

- Does not help after the app is reopened
- Does not solve the user-facing complaint

### Option C: Dedicated backend snapshot cache

Pros:

- Stronger system boundary

Cons:

- Larger surface area
- Unnecessary for a sidebar-only summary cache

## Data Model

Store a single versioned object under the `threads` store.

Suggested key:

- `sidebarSnapshot`

Suggested shape:

```ts
type SidebarSnapshotV1 = {
  version: 1;
  updatedAt: number;
  workspaces: WorkspaceInfo[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
};
```

Constraints:

- `workspaces` uses the same shape already returned by `listWorkspaces()`
- `threadsByWorkspace` contains only sidebar summary data already represented by `ThreadSummary`
- No thread items, no loaded message bodies, no auxiliary per-thread history

## Validation Rules

When reading the snapshot:

- Reject non-object values
- Reject unknown or missing `version`
- Reject non-array `workspaces`
- Reject non-object `threadsByWorkspace`
- Reject entries whose required `WorkspaceInfo` or `ThreadSummary` fields are missing or malformed

If validation fails:

- Ignore the snapshot
- Continue with the current live loading behavior

Malformed cache must never break sidebar rendering.

## Ownership and Boundaries

### `useWorkspaces`

Responsibilities:

- Read cached `workspaces` during initial hook setup
- Use cached workspaces as the first rendered state when available
- Write fresh workspace results back into the snapshot after `refreshWorkspaces()` succeeds

Non-responsibilities:

- Thread summary persistence
- Sidebar rendering logic

### `useThreads` / `useThreadActions`

Responsibilities:

- Read cached `threadsByWorkspace` during initial state setup
- Use cached thread summaries as initial sidebar-visible data
- Persist fresh per-workspace thread lists whenever live list refresh succeeds

Non-responsibilities:

- Message history caching
- Sidebar presentation concerns

### `Sidebar`

Responsibilities:

- Render whatever state it receives

Non-responsibilities:

- Knowing whether data came from cache or network
- Reading or writing persistence directly

## Runtime Flow

### Startup Flow

1. App preloads client stores
2. Workspace hook reads cached workspace snapshot
3. Thread state reads cached thread summary snapshot
4. Sidebar renders immediately from cached state if available
5. Existing startup/restore logic runs live refreshes
6. Fresh results replace cached state
7. Snapshot is rewritten with fresh data

### Live Refresh Flow

The following actions continue to issue live requests and rewrite the snapshot with the latest successful results:

- Initial workspace load
- Workspace restore
- Focus-based refresh
- Manual refresh
- Workspace reconnect + relist
- Any existing flow that already refreshes thread lists after workspace or thread operations

### Failure Flow

If a live refresh fails:

- Keep showing the last successful cached or in-memory sidebar state
- Do not clear the sidebar back to a skeleton-only state
- Do not overwrite a good snapshot with an error result

## Freshness Semantics

Cache is only a startup optimization. It is not an authority source.

The source of truth remains the live backend response.

That means:

- Cached data may appear briefly first
- Live requests still run immediately
- CLI-created sessions are expected to appear once the live relist completes
- The cache must never suppress or skip those relist requests

## Loading Semantics

The implementation should preserve the current `preserveState: true` behavior for thread list refreshes.

Implications:

- When cached thread summaries are already visible, a live refresh should not blank them out
- The UI may still indicate loading, but it should keep showing existing rows until fresh data replaces them

## Implementation Notes

- Prefer a small utility module for sidebar snapshot read/write/validation so both workspace and thread layers can reuse it
- Keep the snapshot versioned from day one
- Write the whole snapshot through the existing debounced client-store path
- Avoid adding a second persistence mechanism such as direct `localStorage`

## Risks

### Risk: stale workspace or thread entries remain visible briefly

Accepted. This is part of the intended stale-while-revalidate behavior.

Mitigation:

- Live refresh still runs immediately
- Fresh results replace stale rows quickly

### Risk: corrupted snapshot breaks startup

Mitigation:

- Strict validation
- Ignore invalid snapshot and fall back to current behavior

### Risk: thread cache and workspace cache become inconsistent

Mitigation:

- Persist them as one logical sidebar snapshot object
- On fresh workspace load, allow thread entries for missing workspaces to be dropped on rewrite

## Testing Plan

### Workspace cache tests

- Hydrates cached workspaces before the first live result arrives
- Replaces cached workspaces when `listWorkspaces()` returns fresh data
- Ignores malformed workspace cache safely

### Thread summary cache tests

- Hydrates cached `threadsByWorkspace` before live list fetch completes
- Replaces cached thread summaries when `listThreadsForWorkspace()` succeeds
- Keeps existing rows visible during live refresh when `preserveState: true`
- Ignores malformed thread snapshot safely

### Integration-oriented behavior tests

- Startup renders cached sidebar content without waiting for live fetches
- A later live refresh can add a new thread not present in cache
- Failed live refresh does not erase cached sidebar content

## Scope Check

This is intentionally a narrow sidebar-summary feature.

It does not require:

- New backend commands
- Message history persistence
- Changes to conversation hydration
- Changes to the existing sidebar visual design

That keeps the implementation focused and reversible.

## Acceptance Criteria

- Reopening the app shows the last known workspace list immediately if a valid snapshot exists
- Reopening the app shows the last known thread summary list for each cached workspace immediately if a valid snapshot exists
- Live refresh still runs on startup
- Fresh live results replace cached results without requiring manual action
- New or changed CLI-created sessions appear after live refresh completes
- Invalid cache is ignored without breaking startup
