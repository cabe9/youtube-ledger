# YouTube Ledger

A local YouTube usage tracker for **Chrome and Firefox**. Records video titles, timestamps and elapsed playback time; separates foreground watching, background audio, silent playback and browsing; and hides recommendations until you reveal them.

## Install

### Chrome

1. Download [the Chrome ZIP](https://github.com/cabe9/youtube-ledger/releases/download/v0.6.9/youtube-ledger-chrome-0.6.9.zip) and extract it to a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder.
4. Pin YouTube Ledger, refresh existing YouTube tabs, and click the extension icon for the dashboard.

Keep the folder in place. The installation survives browser restarts. To update, replace files in the same folder, click **Reload** in the extensions page, and refresh YouTube and the dashboard. Moving the folder can change the extension identity. This is not a Chrome Web Store installation.

### Firefox

1. Download and extract [the Firefox ZIP](https://github.com/cabe9/youtube-ledger/releases/download/v0.6.9/youtube-ledger-firefox-0.6.9.zip).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select the extracted `manifest.json`.
4. Refresh YouTube tabs and open YouTube Ledger from the extension toolbar.

Temporary installations stop at browser restart. A durable Firefox installation requires Mozilla signing, which has not been performed. Export history before removing a temporary installation; do not rely on it surviving removal.

## What it does

- Records a detailed viewing history: which videos you watched, when you watched them, how long they played, and whether playback was in the foreground, background audio, or silent in the background.
- Ignores paused background tabs; actual background playback still counts.
- Lets you assign Work, Learning, Leisure, Background, Unplanned or Unsorted labels to a video's day. Conflicting older labels appear as Mixed until you choose a label.
- Hides the Home feed, related-video sidebar and matching end-screen suggestions by default. Search and subscriptions remain available.
- Places a white-text **Show/Hide recommendations** button to the left of desktop YouTube's search bar. Each navigation resets recommendations to hidden.
- Records Show clicks and recommendations detected in the viewport as distinct events. These are not network-request counts or proof of attention.
- Includes daily totals, a recommendation timeline, a short-video count, a retrowave dashboard, JSON export and an LLM review-prompt export.

DF YouTube or another blocker can still hide recommendations after you click Show. Disable overlapping hiding options there if you want Ledger to control them. Ledger does not read or change other extensions' settings. It does not change autoplay settings.

## Privacy and daily review

No account, API key or external service is required. Usage data stays in your browser profile. The extension does not upload history, record screenshots/audio, or read unrelated websites. Private/incognito use is disabled. Chrome and Firefox histories are separate; synchronization and migration are not implemented.

The source and ZIPs contain no viewing history. Your own exports do contain personal history. Export before uninstalling if you want to keep your data.

Add notes about your day, label videos, and export an LLM review prompt to use with your preferred LLM. No automatic LLM connection is configured. The export asks for an explicit scoring rubric and uses your notes for context. The optional LLM prompt in Advanced settings starts blank; you can supply your own instructions. The old built-in preference is cleared when settings are read; other custom prompts are preserved.

## How tracking works

Foreground records playback while the YouTube page has focus. Background audio records unmuted background playback. Firefox native picture-in-picture may count as background. Multiple simultaneous videos accumulate independently. First/last timestamps can span gaps; use playback totals for duration.

Playback is sampled roughly once a second and saved in batches of five samples. Gaps longer than five seconds are excluded. A sudden close or crash can lose the last unsaved batch. Paused includes buffering and seeking. Old sessions may retain background paused time; original data is preserved as `rawSessions`, while the dashboard uses grouped activity. Use grouped activity for totals and raw sessions for detail.

Short-video counts cover videos with playback under the threshold selected in Advanced settings, including videos in progress. Ads, Shorts metadata, mobile selectors, and recommendation visibility are best-effort and may need adjustment when YouTube changes its layout. The header control waits for a supported desktop header rather than displaying a floating overlay.

## Build and test

Requires Python 3 for packaging and Node.js for tests. The extension itself has no runtime npm dependencies.

```sh
python3 build.py
npm install
npm test
npx playwright install chromium
npm run test:ui
npm run test:recommendations
npm run test:chrome
```

Installable downloads live in [GitHub Releases](https://github.com/cabe9/youtube-ledger/releases/latest); generated ZIPs are not committed to the source tree.

`build.py` produces clean `dist/chrome` and `dist/firefox` folders and browser-specific ZIPs. UI and recommendation checks use installed Google Chrome. The Chrome integration check uses Playwright's Chrome for Testing in a disposable profile, with an actual unpacked extension and controlled YouTube HTML/media fixtures.

Verified: aggregation, paused-tab exclusion, recommendation event storage, UI behavior, content-script injection, real media playback tracking, recommendation controls, purpose labels, pause, data persistence across a full Chrome restart, and worker messaging after restart. Live YouTube layouts and the user's exact theme still require real-world validation.

## License

[MIT](LICENSE). You may use, modify and share the code under the license terms.

## Advanced settings

Expand Advanced settings near the bottom of the dashboard to customize the recommendation default, reset-on-navigation behavior, header button visibility, inclusion of paused-only videos, short-video threshold (1–30 minutes), and your optional LLM prompt. Save applies settings to open YouTube tabs without deleting history. Restore defaults restores the original behavior. Automatic default visibility is not counted as a reveal. CSS initially hides recommendations until the saved preference loads.

Choose **Retrowave**, **Light green**, or **Dark green** under Advanced settings → Dashboard theme, which applies and saves immediately. Other settings still use Save settings. Retrowave remains the default. Light green uses a light background, green accents, and a compact header. Theme selection is saved per browser profile.

Dark green uses charcoal-green backgrounds, muted green accents, and light text with a compact header.

Retrowave includes an animated grid, twinkling stars, and sunset glow. Toggle **Animate retrowave** in Advanced settings to enable or disable motion immediately. The choice saves automatically. System reduced-motion preferences use the static artwork.

The animated sun has transparent bands that rise and narrow toward the top, with a gradual pink/coral/lavender/cyan color cycle.
