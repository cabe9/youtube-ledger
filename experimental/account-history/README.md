# Experimental account history — GitHub only

**Do not submit this build to Chrome Web Store or Firefox Add-ons.** The standard/store extension is built from separate, feature-free source. Its packages contain no account-history reader, UI, export fields, optional Google permission, or references to this experiment. This directory and its integration patch are used only by an explicit experimental build.

```sh
python3 build.py --channel experimental
npm run test:account-history
```

Outputs: `dist/experimental/chrome`, `dist/experimental/firefox`, and `youtube-ledger-{browser}-experimental-0.16.19.zip`. The manifest name is **YouTube Ledger Experimental**. The default `python3 build.py` instead creates the store packages in `dist/chrome` and `dist/firefox`; `python3 package-check.py` verifies their exclusion boundary and stale-file cleanup. Generated packages have not been published.

## Use

In Settings, enable **Cross-device history · Experimental** and grant optional Google My Activity access. Once enabled, opening History checks automatically at most once every 24 hours. Overview and History render cached data immediately and update after a successful check. Opening Overview alone does not request history.

After watching on another device, use **Check for missing history** in History for a bounded catch-up. **Sync now** in Settings performs the same manual check. A manual check can bypass the daily wait, with a shared **20-minute minimum between manual attempts**, including after a restart. A small progress bar and stage text show which batch is being read. The daily check does not automatically search further because overlap is sparse or absent.

Review export checks five-minute freshness but respects the daily request budget. When eligible, it shows “Refreshing cross-device history…” and waits; otherwise it uses the cache and includes the last successful timestamp. This daily budget supersedes the original 15-minute / 5-minute retrieval targets. There are no alarms or scheduled polling. Leaving Ledger open does not continually fetch history.

An automatic check makes at most **two sequential GET requests**: the initial Google My Activity page and the initial YouTube History page. It reads at most 100 Google cards. A manual check can read **three Google batches total**, up to 300 cards: that same initial page plus at most two read-only continuation requests, followed by the YouTube page. It stops earlier at the seven-day date boundary or when Google returns no continuation. Request volume is capped regardless of overlap.

Manual pagination uses the undocumented `GetDisplayItems` request behind Google's own Load more control. Its method, YouTube filter, initial record schema, cursors, and timestamp ordering are checked. The page's short-lived request context is parsed as data, sent only back to Google, and discarded after the attempt; it is never saved in Ledger storage or exports. This remains an unsupported integration.

No tabs open, history navigation is not required, and no scrolling, device-detail clicks, source scripts, video playback, player metadata requests, or cookie API access occur. Redirects are not followed and requests are not retried within an attempt. Each request has a 15-second timeout and a 6 MiB response cap; a full attempt is bounded to 70 seconds.

Chrome uses a bundled local offscreen document solely to parse an inert HTML template. It cannot load images, frames, or remote scripts and is closed after parsing. Firefox parses the same template in its background document. Chrome's `offscreen` permission is included only in the experimental package; Google host access is optional in both. The former `scripting` permission is no longer requested or used.

## Limits and approval

This is an unofficial, best-effort reader. Neither low request volume nor absence of tabs establishes Google's approval or guarantees account safety. There is no evidence here that automating visible tabs is safer. The reader stops on unexpected layouts or sign-in challenges instead of trying to get around them. A 403/429 response stops the attempt immediately and pauses automatic refresh until you choose to retry. The first refusal requires at least 48 hours; another refusal before a successful sync requires at least seven days. A longer server `Retry-After` is honored. History and Settings show the HTTP status and earliest manual retry time; manual buttons stay disabled during the wait. These are conservative local limits, not a promise that waiting will resolve a 403. Schema/sign-in/account errors also require a manual retry after cooldown. Network failures back off from one hour up to 24 hours and honor longer server waits; automatic checks still respect the daily minimum. Cache and successful timestamps survive failures, disabling, and restarts; toggling cannot reset the request budget.



A bounded check is **not a complete archive**. Heavy viewing, delayed Google activity, unavailable items, selected YouTube history filters, or account/brand-profile mismatches can leave gaps. Even after three Google batches, classification still uses YouTube's initial page: older entries absent from that payload cannot be imported. Unmatched Google events are omitted (some may be ads); Shorts classification is never guessed from duration or hashtags. Explicit platform metadata is retained when available, but devices often remain unknown because detail dialogs are not opened.

Coverage reports the number of entries checked, batches read, and matches to **previously recovered imports**. Directly tracked browser watches are excluded from that overlap count. Overlap is supporting information only: finding repeats, finding none, or reaching the end of a response does not prove that every watch from another device has arrived. A successful sync means the bounded response was read.

Synthetic extension tests exercise the three-batch cap, timestamp parsing and media classification. These checks validate the bounded implementation, not completeness or long-term compatibility with Google’s pages.

## Local data and compatibility

Imported data stays in `storage.local`; there is no upload or automatic LLM connection. User-triggered exports can contain imported history. Existing directly tracked records, settings, labels, notes, and foreground/background behavior keep their original formats and remain authoritative. Recovered normal videos have no watch-duration estimate. Shorts sessions are explicitly labeled estimated from synced history; see [model notes](model-notes.md).

To retain an existing Chrome profile's data, replace files in the same unpacked installation folder and reload. Copy the complete chosen package, removing obsolete files first, rather than mixing channels. Firefox retains the existing extension ID for compatibility; store and experimental packages are alternative versions, not co-installable add-ons. Export before changing installations. The store build leaves any previously saved experimental storage untouched but does not read, render, or export it. Switching back to an experimental build can read the prior cache. Disable syncing to stop future reads; Delete day deletes local imports and preserves a cutoff against reimport, without changing Google's history.

## Development checks

Pure normalization, reconciliation, sessions, persisted daily/manual budgets, failure backoff, cancellation, continuation decoding, and source request bounds are tested in `account-history.test.cjs`. `account-history-check.cjs` uses an actual Chrome extension in a disposable profile with synthetic HTML and continuation responses, including 187 shelf entries and three 100-card batches. It checks the local offscreen parser, cached-first rendering, no source tabs or resource execution, progress, single flight, overlap excluding direct watches, direct-record authority, collapsed sessions, cached review fallback, persistent refusal warnings, server-directed waits, and four themes at narrow widths. Personal browser profiles and watch records are not fixtures or package contents.

Reconciliation uses observed wall-clock playback intervals when a desktop row contains them. A phone watch inside a long desktop pause remains recovered. For legacy rows without intervals, a match requires either enough recorded playback to cover the entire row span, or a row wholly inside the recovered watch’s minute. Ambiguous older spans retain the recovered event rather than assuming continuous desktop playback. New desktop rows keep up to 2,048 disjoint intervals per session/day; discarded intervals are not treated as proof of a match.
