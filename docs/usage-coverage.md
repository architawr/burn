# Usage coverage and workflow accounting

## Two different kinds of child work

Native subagents can run inside one provider session. BB workflows instead spawn hidden worker threads with `lifecycleOwnerThreadId`; this is distinct from `parentThreadId`. BB's descendants API currently traverses parentage only. Burn extends the returned family over both edges, including nested workers and workers' ordinary children, with deduplication and cycle protection. The global Spend report continues to sum each thread's own report once. Native transcript calls belong to that own report and are not added again as BB worker reports.

A replayed workflow call does not create another worker or another usage record. Real retry attempts that create additional workers remain separate spend. This patch does not change workflow execution or retry policy.

## Sources

| Harness | Source and verification | Remaining limits |
| --- | --- | --- |
| Claude Code | Host reads `CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects`, matching exact session identities. Recursively includes `session/subagents/**/agent-*.jsonl`. Repeated API message snapshots count once; the last usage wins. Tested against an independent inventory of existing real transcripts. | Deleted transcripts cannot be recovered. Host environment overrides must match the provider configuration. Background calls are grouped by timestamp and can appear under a later prompt. Partial session history keeps a previously saved report; without one, partial coverage is shown. |
| Codex | BB usage events. `turn/started.parentToolCallId` and turn scope separate a native child's counter from its parent's, even when BB writes both with the same provider session ID. Verified with a live native-child run and a live BB workflow worker. | Events pruned before Burn observes them lose detail. Previously persisted incorrect ledger records are not rewritten. A native child's model is priced using the latest BB request model because usage events do not carry its model. Different-model delegation therefore needs bridge support for accurate model attribution. |
| OpenCode | Existing read-only `opencode.db` reader follows task-tool children by session parent ID; regression tests cover nesting and recorded/estimated usage. | Existing limits remain: eight child levels and the newest 20,000 messages per session. This patch does not remove these limits or make their truncation visible in the UI. No fresh live OpenCode model call was made for this patch. |
| Pi / API through Pi | Existing Pi log reader uses assistant-message usage and recorded cost. Existing regression tests pass. | Only known BB Pi session identities at the standard bridge directory are covered. Custom bridge directories and arbitrary subprocess sessions are not discovered. No new paid API request was made for this patch. |
| Direct API calls from tools or shell | Counted only if their usage is recorded in an already supported source. | Burn does not intercept arbitrary HTTP calls. Missing telemetry must not be interpreted as zero spend. |

## Why Codex counters need separate identities

A minimal interleaving is: parent cumulative total 100, child total 80, parent cumulative total 220. Treating the child as a parent restart gives `100 + 80 + (220 - 80) = 320`. Separate counters correctly give `220 + 80 = 300`. The regression fixture covers this interleaving and a ledger reload between child and parent events.

The new child-turn map is persisted in the existing ledger state; older states without it still load. Exact separation requires the child's start event. This cannot retroactively repair data whose start/usage events BB already deleted, or a child turn already in progress when upgrading from an older ledger cursor.

## Costs and updates

Transcript usage preserves each call's model, input, output, cache reads and cache writes. Known models use list-price estimates, including the one-hour cache-write surcharge when recorded. Unknown model names retain tokens with no invented price. Custom proxy pricing, subscription invoices and service-tier surcharges are not inferred. Estimated cost is not an invoice.

Claude host reads run on BB event/status invalidation and the report TTL; they are not an independent filesystem watch, so a background task that produces no BB event can appear on the next refresh. Incomplete final JSONL lines wait for their newline. Truncation, replacement and a changed first line invalidate the file cursor. Only extracted usage and short prompt excerpts are cached, not tool-output bodies.

## Validation

The test suite covers the new reader, recursive workflow paths, duplicate snapshots, appended partial JSONL, unknown models, one-hour cache writes, copied fork history, rewritten files, host/event fallback, preserving saved history, lifecycle ownership, and interleaved Codex child counters. Existing OpenCode, Pi/API usage, budget, report and frontend suites remain in the full run.

On Node 26, run browser tests with `NODE_OPTIONS=--no-experimental-webstorage npm test`; otherwise Node's global Web Storage conflicts with jsdom in the existing suite. Typecheck uses the repository's pinned SDK. `bb plugin build` also checks the installed BB build pipeline; existing SDK-version and retired-slot warnings are outside this patch.

The live checks call the patched reader/ledger/family functions against actual provider data. They do not install the development plugin into the user's running BB or claim an end-to-end UI installation test. Real private transcripts and temporary audit tests are not included in the PR.
