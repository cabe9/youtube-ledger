# YouTube Ledger 0.19.0 — Chrome reviewer instructions

This is a browser-only extension. There is no Ledger account, server login, payment, native companion or cross-browser sync. A normal YouTube video can be used without signing into YouTube. Discover, the subscription filter, Subscribe, channel feedback and the optional Watch Later/history-page features use the reviewer's own YouTube session.

## Update from public 0.18.1

Version 0.19.0 adds Discover to the encrypted Chrome edition: local channel statistics, subscription filtering, explicitly queued channel feedback and native inline Subscribe. The archive of public 0.18.1 is preserved for upgrade testing.

Permissions remain `storage` plus `https://www.youtube.com/*` and `https://m.youtube.com/*`. No alarms, native messaging or optional permission is added. The bundled Chrome privacy policy is revision 0.19.0; its updated hosted copy has not yet been deployed.

## First run and permissions

1. Install the submitted update in a disposable Chrome profile and allow its requested access to `www.youtube.com` and `m.youtube.com`. Open YouTube Ledger from Chrome's Extensions menu or its pinned toolbar icon.
2. Choose a test passphrase of at least 12 characters, confirm it and continue. “Open automatically in this browser” is unchecked; leave it unchecked for the first test. Save the generated recovery key and confirm that you saved it.
3. The next screen asks what to track. All tracking/behavior choices start unchecked. Enable recording and save your choices. YouTube lookups/images and account actions remain off until separately allowed.
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

## Discover and optional account actions

1. Enable recording and allow YouTube lookups/images. Use the Discover link in YouTube's sidebar or the recommendation menu next to search. Discover reads your signed-in subscriptions to exclude channels you already follow.
2. The frequent-watch list needs three videos with at least 30 seconds each, two watching days, and five minutes total within 30 days. The repeated-recommendation list needs observations on three Home visits and excludes channels in the frequent-watch list. A new profile can legitimately show empty lists. See the stats explanation in Discover. Automated tests use synthetic qualifying history.
3. Confirm that Dismiss and Remind later affect only Discover, and that Undo restores a dismissed channel. With images enabled, both tabs show the creator's picture. Only the frequent-watch tab shows a last-watched video preview; the repeated-recommendation tab shows channels and statistics. The headline and bar use all retained Home visits within 30 days, subject to storage limits.
4. After allowing account actions, Subscribe uses YouTube's native Subscribe button without navigating away. It verifies the exact account and channel, cancels pending feedback for that channel and rereads subscriptions before showing success. An unconfirmed send is not retried automatically. The packaged MAIN-world adapter has no extension API or cookie access.
5. “Don’t recommend channel” sends through YouTube's native menu when a matching card is available. Otherwise it stays Pending. Unsent requests expire after 30 days, including during preparation. The list shows request and expiration dates. The user can view and cancel saved requests before sending, even if subscription checks fail or connections are disabled. Requests for other accounts remain visible and labelled; their account identity must still match before sending. Later sends require the same account, a matching recommendation in a focused idle tab, and enabled connections. Newly subscribed channels are cancelled; uncertain sends are not automatically retried. Backups exclude this queue and its account marker.
6. Only use a disposable YouTube account for real account actions. The automated native Subscribe check intercepts every outgoing subscription write and never changes an account. A confirmed real action affects YouTube, not just Ledger's local display.
7. Select subscribed-only recommendations, hide and reveal again, then reload. The preference persists. It filters the recommendations YouTube already supplied and does not fetch a replacement feed.

Watch Later cleanup retains its separate setting and removal-count confirmation. It uses YouTube's native controls for the selected videos.

## Privacy and limitations

The package's `docs/privacy.html` is the same document prepared for the Chrome-specific public privacy URL. There are no analytics or developer data uploads. Public metadata requests use HTTPS and omit account cookies. Subscription checks and Subscribe metadata reads use the browser’s signed-in session, without reading authentication cookies. All are subject to the connection controls.

Automatic access is a convenience option: someone who can use or copy the browser profile may be able to open saved data. Passphrase-only mode keeps the unlocked key out of persistent browser storage. No claim of independent security certification is made.

If both credentials are lost, the developer cannot reset them. If the vault itself is damaged, restore an intact backup into a fresh Ledger installation using the backup's credential. Do not remove an installation containing the only copy of wanted data.
