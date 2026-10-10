# Chrome 0.18.1 permission audit

The October 8, 2026 rejection of 0.18.0 identified an unused `alarms` permission (Purple Potassium). The calls to that API are in `local-sync.js`, which the public Chrome build excludes. `compat.js` only exposed the API; it did not call it. The earlier store justification incorrectly attributed upload checks to alarms.

`chrome-vault/store-edition.py` now removes both the inherited permission and its unused adapter. Firefox and the companion preview retain alarms because their sync implementation uses it.

| Requested access | Active use in the public package |
| --- | --- |
| `storage` | `vault-worker.js` uses `chrome.storage.session` for the unlocked session and trusted transient state, and `chrome.storage.local` to migrate older records. Encrypted profile records use IndexedDB; that API alone does not justify the permission. |
| `https://www.youtube.com/*` and `https://m.youtube.com/*` | Declared content scripts observe opted-in playback and provide on-page controls. `vault-worker.js` queries matching tabs and sends messages; other modules fetch supported YouTube resources after user consent. |

There are no optional permissions, general browsing-history access, native messaging, or all-site host patterns in the store manifest. Upload checks use tab activity and refresh messages, not an alarm listener.

The package check enforces the exact permissions and hosts. The browser lifecycle check inspects the installed extension's actual grants, then exercises setup, restart, recovery, updates, deletion and backup restore without alarms. Release numbers and the unchanged privacy-policy revision are recorded in `chrome-vault/release.json`. Historical 0.18.0 archives and receipts remain separate.
