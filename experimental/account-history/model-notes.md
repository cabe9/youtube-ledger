# Local account-history v1

This implementation uses bounded account-history reads. Google timestamps and video lengths are evidence of activity, not actual watched seconds. Synthetic fixtures exercise classification, reconciliation and request limits.

## Modules and storage

- `account-history-source.js`: bounded initial-page GETs, optional manual continuation, and media classification. Browser-managed sign-in is reused; tabs are never opened. YouTube's initial shelf payload classifies Shorts, including entries absent from the rendered six-card carousel; video renderers and video lockups classify normal videos. Google cards and continuation records provide event metadata and minute timestamps. Google ads/posts/unclassified records are excluded by joining against YouTube history IDs.
- `account-history-parser.js`: inert Google HTML parsing and pure YouTube initial-data parsing. Chrome's local offscreen parser closes after use; Firefox uses its background document. Source scripts and subresources never execute or load.
- `account-history-rpc.js`: the undocumented read-only `GetDisplayItems` request (`y3VFHd`) used by Google's Load more control. It validates the YouTube request template, decodes bootstrap/continuation data without evaluating scripts, and keeps request context in memory only. The source validates initial RPC records against rendered cards and checks cursor/timestamp advancement before accepting older batches.
- `account-history.js`: pure normalization, idempotent merging, direct reconciliation, Shorts sessions, and projections.
- `account-history-sync.js`: one shared background-service flight across dashboards, a separate mutation queue, permissions, account pinning, cancellation, durable daily/manual request budgets, and exponential failure cooldown. Direct event ingestion keeps the existing collection path.
- `account-history-ui.js` / `.css`: cached rendering, view-entry freshness checks, review preparation, compact metrics, settings controls, and expandable history rows. Existing themes and navigation stay in place.

Existing `day:*`, purposes, notes, settings, and recommendation records retain their formats. New local keys are:

| Key | Contents |
| --- | --- |
| `accountHistory:config` | Opt-in `enabled` and a revision for cancelling outdated work |
| `accountHistory:cache` | Schema version 1; observations, Shorts sessions, hashed account identifier, successful-sync timestamp, newly recovered count, direct-match count, coverage, estimation model, and day-deletion timestamps |
| `accountHistory:status` | Current attempt/run, start time, in-progress phase, last attempt/manual-attempt timestamps, last refresh error, next allowed attempt, HTTP status, server retry time, failure/refusal counts, and manual-retry requirement |

The first successful sync pins a SHA-256 hash of the Google account identity. A later different account fails without changing the cache. This hash is a local consistency key, not an authentication credential or a guarantee of anonymity. Multi-account and YouTube brand-profile configurations must have matching history surfaces. There is no automatic account migration in v1.

An event contains `id`, `accountKey`, `videoId`, `title`, `channelName`, nullable `channelId`, canonical `url`, `watchedAt` in epoch milliseconds, `timestampPrecision: minute`, `timeZone`, original `watchTimeText`, nullable `videoDurationSeconds` and `device`, `mediaType: short | video`, `trackingMethod: account-history`, `watchedSeconds: null`, occurrence ordinal, and source order. Same-video/same-minute repeat occurrences get distinct IDs. Identity never depends on position within a refreshed page.

The cache retains source observations that directly match Ledger so reconciliation can be recomputed. Only the recovered projection contributes imported activity to the UI/export. Event metadata is stored once, rather than duplicating recovered titles and URLs in a second array. A later direct write immediately supersedes an import on the next local render; directly measured totals, purposes, foreground/background breakdowns, and raw rows are not overwritten. Normal imported video length is always metadata, never watch duration.

## Reconciliation and estimation

A direct match requires the same video ID, a direct row with positive foreground/audio/silent playback, and interval overlap with `[watchedAt, watchedAt + 60 seconds)`. It does not discard all watches of the same video on the same day. Two indistinguishable watches within that minute can still be ambiguous; the direct record wins. Since existing direct row spans can include pauses, the matching interval is approximate too.

Recovered Shorts are processed in chronological order; source order breaks timestamp ties. The next Short joins if its timestamp is no later than the previous timestamp plus the previous video's duration plus 60 seconds. Normal videos, directly matched watches, day/account boundaries, and missing previous lengths break runs. A Short with a missing length can join a preceding known-length Short, but its session has a null duration estimate; the next event starts a new session. The Overview reports how many Shorts were excluded from estimated time. Sessions store start/end times, estimated active minutes, event IDs/count, model, and device only when every event explicitly reports the same device/platform.

The model `shorts-interval-union-v1` unions `[watch timestamp, watch timestamp + video length]` intervals. Overlap counts once and idle gaps are excluded. This deliberately avoids multiplying a minute by the number of Shorts in that minute. It can underestimate rapid sequential Shorts sharing a timestamp, or overestimate quick skips. Replays, seeking, delayed sync, incomplete activity, and minute rounding prevent exact duration recovery. Session end is also an estimate, and a final video interval can extend into the next date while belonging to its start date. Do not add these numbers to directly measured playback or infer completion/progress from them.

## Freshness, failure, and bounds

Overview and History first render storage. History entry or visibility return can start an automatic check only when both the last attempt and last successful sync are at least 24 hours old. Overview alone does not initiate a check. Manual checks bypass the daily wait but share a persisted 20-minute minimum between manual attempts across both buttons. Error backoff takes precedence over both budgets. Review preparation checks five-minute freshness and waits only for an eligible daily refresh; the daily budget takes priority over the original 15/5-minute retrieval targets. There are no alarms or scheduled history polling. Existing five-second local rendering does not call the source. A local keepalive runs only during an active source read.

Automatic reads use at most two initial-page GETs and 100 Google cards. Manual checks add at most two Google continuation requests, for three Google batches / 300 cards total within seven local calendar days, plus YouTube's initial page for classification. There are at most four sequential requests, with a 15-second timeout and 6 MiB cap each, and a 70-second overall deadline. Pagination stops at the date boundary, absent continuation, or batch cap. Repeated cursors and out-of-order older batches fail without committing. A failure at any stage preserves the prior cache; there is no partial commit or immediate retry.

Only previously recovered account-history imports are supplied as overlap evidence; source observations reconciled to direct rows are excluded. Overlap never triggers extra requests or establishes completeness. Coverage stores the batch/card counts, overlap count, stop reason, unmatched count, and source date range with `completeness: unknown`. YouTube classification does not paginate, so even a successful manual catch-up may miss older entries. Devices remain unknown unless explicitly present in prior imports or continuation metadata. No detail dialogs are opened.

Network errors back off from one hour to 24 hours; automatic retries also respect the daily minimum. A first 403/429 requires at least 48 hours, and each later refusal before a successful sync requires at least seven days. A valid longer `Retry-After` (integer seconds or HTTP date) extends either wait. Refusals keep automatic sync paused until a successful manual retry; a later network failure cannot clear that pause. Success resets the refusal count. History and Settings retain a warning with the status code and earliest manual retry time. Sign-in, account, or schema errors pause automatic refresh and require manual retry after cooldown. Both last-attempt timestamps are persisted before requesting; disabling or restarting does not erase the budget.

Failures preserve the last successful cache and timestamp. Sign-in/verification, permissions, account mismatch, source schema changes, and timeouts are surfaced in Settings. Review exports can proceed from cached data and carry the last successful timestamp and error. Disabling during a refresh or deleting a day cannot be undone by a late commit. Day deletion preserves a local cutoff so old Google events do not reappear; it never deletes Google's copy.

Google host access `https://myactivity.google.com/*` is optional; existing YouTube access is reused. Chrome additionally uses `offscreen` for a local inert parser. No script injection permission is used. No account-history reader runs until enabled. Everything is stored in `storage.local`; exports are user-triggered files, with no server upload or LLM connection. Disabling retains imports. Pause tracking remains a separate direct-tracking control.

On browsers exposing a fixed local-storage quota, an import reserves up to 2 MiB (at most one quarter of the quota) for direct tracking and other settings. When that reserve would be consumed, sync keeps the prior cache and asks the user to export/delete older days. This is not automatic retention or unlimited storage; high-volume long-term archives remain a future storage-design concern.

## Verification

See the experimental build instructions in this directory (`README.md` in source, `EXPERIMENTAL.md` in packages). Fixtures cover initial snapshots, manual continuation, daily/manual budgets, refusal escalation, server-directed waits, persistent warnings, inert parsing, source limits, and the exclusion boundary in store artifacts. The original tab-and-scroll adapter is superseded; it is not shipped in either channel.

Reconciliation uses observed wall-clock playback intervals when a desktop row contains them. A phone watch inside a long desktop pause remains recovered. For legacy rows without intervals, a match requires either enough recorded playback to cover the entire row span, or a row wholly inside the recovered watch’s minute. Ambiguous older spans retain the recovered event rather than assuming continuous desktop playback. New desktop rows keep up to 2,048 disjoint intervals per session/day; discarded intervals are not treated as proof of a match.
