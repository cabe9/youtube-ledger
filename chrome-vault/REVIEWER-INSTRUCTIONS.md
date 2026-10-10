# YouTube Ledger 0.18.1 — Chrome reviewer instructions

This is a browser-only extension. There is no Ledger account, server login, payment, native companion or cross-browser sync. A normal YouTube video can be used without signing into YouTube. Only the optional Watch Later/history-page features need the reviewer's own YouTube session.

## Correction to the October 8 rejection

Version 0.18.1 removes the unused `alarms` permission identified as Purple Potassium. It was inherited from the companion-sync preview, but the public edition excludes that feature. The unused alarms adapter is also removed. Upload checks are initiated by tab activity and explicit refresh messages; they do not use the alarms API.

The remaining permission is `storage`, used by `vault-worker.js` for trusted `chrome.storage.session` state and migration from `chrome.storage.local`. Host access remains limited to `https://www.youtube.com/*` and `https://m.youtube.com/*` for the declared content scripts, supported tab queries and YouTube requests. No optional permissions are requested. The existing Chrome privacy policy, dated October 3 and labeled 0.18.0, also covers this patch: data handling is unchanged.

## First run and permissions

1. Install the submitted ZIP and allow its requested access to `www.youtube.com` and `m.youtube.com`. Open YouTube Ledger from Chrome's Extensions menu or its pinned toolbar icon.
2. Choose a test passphrase of at least 12 characters, confirm it and continue. “Open automatically in this browser” is unchecked; leave it unchecked for the first test. Save the generated recovery key and confirm that you saved it.
3. The next screen asks what to track. All tracking/behavior choices start unchecked. Enable recording and save your choices. YouTube lookups/images and Watch Later account actions remain off until separately allowed.
4. The setup connection check can help diagnose missing site access. If Chrome has withheld YouTube access, allow it for YouTube and refresh existing YouTube tabs. It is a browser permission, separate from the optional lookups setting. A new tab loaded after granting access also works.

## Ordinary use

1. Play a public YouTube video for at least 15 seconds. Open Ledger History; playback is sampled about once a second and summaries refresh about every five seconds.
2. Add a note or a purpose label. In Settings → General, change themes. The four themes are Retrowave, Frutiger Aero, Light green and Dark green.
3. Create a channel group. Adding/resolving a channel or checking for new uploads requires enabling optional YouTube lookups/images in Settings → YouTube. Cached groups and local data remain available with that connection off. Throttling and incomplete YouTube metadata can delay or limit results; the feed and diagnostics explain recorded failures or cooldowns.
4. Pause tracking in the header and verify that new activity stops. Pausing does not delete history or disable explicit group/backup actions.

## Restart and recovery

1. Quit the whole test browser and reopen the same profile. In passphrase-only mode the saved dashboard is locked. New viewing can still be encrypted and queued if recording was enabled.
2. Enter a wrong passphrase; it must not unlock. Unlock with the chosen passphrase or select “Use my recovery key.” Queued viewing is organized into History.
3. Settings → Your data → Access to your Ledger offers automatic access. Enabling it shows a disclosure and confirmation. It saves a non-extractable key in the browser profile, not in an OS key store. No native permission or external app is requested.
4. Restart the browser with automatic access enabled. Ledger opens without prompting. Turn it off using a verified passphrase/recovery key; the next complete restart requires unlocking again.
5. Passphrase changes and replacement recovery keys do not change credentials for previously exported backups.

## Backups and deletion

1. In Settings → Your data, export a full profile. The JSON envelope is encrypted; it should not contain readable history or notes. Individual day/group/review exports are intentionally readable and are labeled separately.
2. Select a full backup to import. Ledger asks for that file's passphrase/recovery key if necessary, validates its contents and shows a preview. Nothing is replaced until Restore is selected. A recovery backup is downloaded before replacement.
3. Supported older readable Ledger backups can be imported and become encrypted locally. Current Firefox releases cannot open these new encrypted Chrome backups.
4. Date-range deletion and retention remove history/notes, with separate watch-status controls. “Delete all Ledger data” is destructive: it clears the local records, removes automatic browser access and reloads with tracking off. It retains the empty vault's passphrase/recovery credentials. It does not delete exports or YouTube account data.

## Optional account action

Watch Later cleanup works only on supported English desktop YouTube. It starts disabled and has separate consent. After enabling it, the user selects loaded Watch Later rows and confirms the removal count before Ledger uses YouTube's native controls. It does not read cookies or call a private account API. Please do not test removals on videos you want to retain.

## Privacy and limitations

The package's `docs/privacy.html` is the same document prepared for the Chrome-specific public privacy URL. There are no analytics or developer data uploads. Public YouTube requests use HTTPS, omit account cookies, and are separately enabled.

Automatic access is a convenience option: someone who can use or copy the browser profile may be able to open saved data. Passphrase-only mode keeps the unlocked key out of persistent browser storage. No claim of independent security certification is made.

If both credentials are lost, the developer cannot reset them. If the vault itself is damaged, restore an intact backup into a fresh Ledger installation using the backup's credential. Do not remove an installation containing the only copy of wanted data.
