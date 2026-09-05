# YouTube Ledger

A local YouTube usage tracker for **Chrome and Firefox**. Records video titles, timestamps and elapsed playback time; separates foreground watching, background audio, silent playback and browsing; and hides recommendations until you deliberately reveal them.

## Install

### Chrome

1. Download [the Chrome ZIP](youtube-ledger-chrome-0.6.1.zip) and extract it to a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder.
4. Pin YouTube Ledger, refresh existing YouTube tabs, and click the extension icon for the dashboard.

Keep the folder in place. The installation survives browser restarts. To update, replace files in the same folder, click **Reload** in the extensions page, and refresh YouTube and the dashboard. Moving the folder can change the extension identity. This is not a Chrome Web Store installation.

### Firefox

1. Download and extract [the Firefox ZIP](youtube-ledger-firefox-0.6.1.zip).
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select the extracted `manifest.json`.
4. Refresh YouTube tabs and open YouTube Ledger from the extension toolbar.

Temporary installations stop at browser restart. A durable Firefox installation requires Mozilla signing, which has not been performed. Export history before removing a temporary installation; do not rely on it surviving removal.

## What it does

- Shows one row per video per local day, combining repeat visits and hiding videos with no playback.
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

Enter your daily intentions, label videos, and export an LLM review prompt to use with your preferred LLM. No automatic LLM connection is configured. The prompt includes the preference to avoid random recommendation browsing and choose other leisure activities, asks for an explicit scoring rubric, and flags uncertain inferences. You can edit that preference in Advanced settings.

## Accuracy and limitations

Foreground focus does not prove watching; unmuted playback does not prove listening. Firefox native picture-in-picture may count as background. Multiple simultaneous videos accumulate independently, so totals are not unique wall-clock time. First/last timestamps can span gaps; use playback totals for duration.

Playback is sampled roughly once a second and saved in batches of five samples. Gaps longer than five seconds are excluded. A sudden close or crash can lose the last unsaved batch. Paused includes buffering and seeking. Old sessions may retain background paused time; original data is preserved as `rawSessions`, while the dashboard uses grouped activity. Do not add raw and grouped totals together.

Short-video counts cover unique videos played for up to three minutes that day, including unfinished viewing; they do not establish that recommendations caused those visits. Ads, Shorts metadata, mobile selectors, and recommendation visibility are best-effort and may need adjustment when YouTube changes its layout. The header control waits for a supported desktop header rather than displaying a floating overlay.

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

`build.py` produces clean `dist/chrome` and `dist/firefox` folders and browser-specific ZIPs. UI and recommendation checks use installed Google Chrome. The Chrome integration check uses Playwright's Chrome for Testing in a disposable profile, with an actual unpacked extension and controlled YouTube HTML/media fixtures.

Verified: aggregation, paused-tab exclusion, recommendation event storage, UI behavior, content-script injection, real media playback tracking, recommendation controls, purpose labels, pause, data persistence across a full Chrome restart, and worker messaging after restart. Live YouTube layouts and the user's exact theme still require real-world validation.

## License

[MIT](LICENSE). You may use, modify and share the code under the license terms.

## Advanced settings

Expand Advanced settings near the bottom of the dashboard to customize the recommendation default, reset-on-navigation behavior, header button visibility, inclusion of paused-only videos, short-video threshold (1–30 minutes), and your LLM review preference. Save applies settings to open YouTube tabs without deleting history. Restore defaults restores the original behavior. Automatic default visibility is not counted as a deliberate reveal. CSS initially hides recommendations until the saved preference loads.

Choose **Retrowave** or **Classic · light green** under Advanced settings → Dashboard theme, then Save settings. Retrowave remains the default. The Classic option restores the original light green palette and compact header. Theme selection is saved per browser profile.
