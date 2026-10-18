# YouTube Ledger 0.20.0 — Chrome reviewer instructions

This is a browser-only extension. There is no Ledger account, server login, payment, native companion or cross-browser sync. A normal YouTube video can be used without signing into YouTube. Discover, the subscription filter, Subscribe, channel feedback and the optional Watch Later/history-page features use the reviewer's own YouTube session.

## Update from public 0.19.0

Version 0.20.0 simplifies first-run setup. A fresh profile can start without a password, choose a password lock, or explore without recording or connections. Existing 0.19.0 protected profiles retain their credentials, records and manual/automatic access settings. The earlier 0.18.1 and 0.19.0 packages remain archived for upgrade testing.

Permissions remain `storage` plus `https://www.youtube.com/*` and `https://m.youtube.com/*`. No alarms, native messaging or additional host permission is added. The bundled and hosted Chrome privacy policy is revision 0.20.0.

## First run and permissions

1. Install in a disposable Chrome profile and allow its requested access to `www.youtube.com` and `m.youtube.com`. Open YouTube Ledger from the Extensions menu or its pinned icon. No recording or optional connections start just from viewing setup.
2. On the welcome screen, Use recommended setup enables recording, YouTube lookups/images, automatic group upload checks and account-action consent. It does not subscribe, send feedback or remove videos. Watch Later cleanup, passive watch learning and recommendation hiding remain off. No password is required; Ledger opens automatically after restart.
3. In another fresh test profile, Choose settings shows the recommended selections individually. Decline any of them; automatic upload checks require lookups. Back retains custom selections without enabling them. Explore first opens with recording and connections off, even from an unfinished custom password form.
4. To test a protected profile, choose settings and select the optional password lock. Enter a test password of at least 12 characters and confirm it. Save the recovery key and confirm that you saved it. Recording and connections wait for that final step.
5. Each connection can also be changed independently in Settings → YouTube. Chrome's site access remains a separate browser permission. If withheld, allow it for YouTube and refresh existing YouTube tabs.

## Ordinary use

1. Play a public YouTube video for at least 15 seconds. Open Ledger History; playback is sampled about once a second and summaries refresh about every five seconds.
2. Add a note or a purpose label. In Settings → General, change themes. The four themes are Retrowave, Frutiger Aero, Light green and Dark green.
3. Create a channel group. Adding/resolving a channel or checking for new uploads requires YouTube lookups/images, enabled during setup or in Settings → YouTube. Cached groups and local data remain available with that connection off. Throttling and incomplete YouTube metadata can delay or limit results; detailed refresh diagnostics are available in debug mode.
4. Pause tracking in the header and verify that new activity stops. Pausing does not delete history or disable explicit group/backup actions.

## Restart and recovery

1. Quit the whole test browser and reopen the same profile. A profile without a password lock opens automatically. This uses unlocking material saved in the browser profile, not an OS key store; a person who can use or copy the profile may be able to open Ledger.
2. Settings → Your data offers Add a password lock. Add a disposable test password and save its recovery key. Existing records remain readable after the change. After restarting, a wrong password must not unlock; the correct password or recovery key must work.
3. In passphrase-only mode, opted-in viewing can still be encrypted and queued while locked. Unlock to organize it into History.
4. A protected profile's Access to your Ledger controls still offer Open automatically in this browser. Enabling it shows a disclosure and confirmation. It saves a non-extractable key in the browser profile; no native permission or app is requested. Disabling it requires a working password/recovery key; the next complete restart requires unlocking.
5. Upgrade an existing 0.19.0 protected profile. The new welcome flow must not replace its access choices, change its credentials or clear its history. Both manual and automatic access are covered by the release tests.

## Backups and deletion

1. In Settings → Your data, export a full profile. A profile without a password lock asks for a password for this backup file. Cancel must create no file. A protected profile exports using its existing password/recovery protection.
2. Select a full backup to import. Enter that file's original password/recovery key when prompted. Ledger validates the file and shows a preview before Restore. A recovery backup is downloaded before replacement; cancelling its password prompt cancels the restore too.
3. Full backups contain encrypted records, not readable history or notes. Device unlocking keys and automatic-access choices never travel in backups. Independent export passwords do not add a lock to the current profile. Adding/changing a profile password later does not change older backups' credentials.
4. Individual day/group/review exports are intentionally readable and labelled separately. Older readable Ledger backups can be imported and become encrypted locally. Current Firefox releases cannot open encrypted Chrome backups.
5. Date-range deletion and retention remove history/notes, with separate watch-status controls. Delete all Ledger data clears local records and reloads with tracking off. A protected profile retains its empty vault's credentials but loses automatic access; a profile without a password remains device-accessible. Exports and YouTube account data are unaffected.
6. A device-only profile has no recovery credential if its local unlocking key is lost. Keep the original profile and restore a separately exported backup into a fresh profile. Older Chrome releases cannot open a live 0.20.0 device-only profile; use an encrypted backup rather than downgrading it.

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

The developer cannot reset lost profile or backup credentials. If the vault itself is damaged, restore an intact backup into a fresh Ledger installation using the backup's credential. Do not remove an installation containing the only copy of wanted data.

## Release verification

The macOS Chromium release suite passed storage/crypto, fresh setup, real 0.19.0 manual/automatic upgrades, real 0.18.1 upgrade, recording/migration, automatic access, near-quota migration, deletion/restore, Discover and exact-package checks. Windows runtime testing was not performed; LF/CRLF build portability was checked. All automated activity and credentials are synthetic.
