# Chrome Web Store submission materials — 0.18.1

Prepared for the browser-only release candidate. Version 0.18.1 is uploaded to the existing Chrome Web Store draft; it has not been submitted for review. Use the package and screenshots from `dist/chrome-release-candidate/0.18.1/`.

## Name

YouTube Ledger

## Short description

Understand your YouTube viewing with local history, channel groups, notes and recommendation controls.

## Full description

YouTube Ledger helps you understand how you spend time on YouTube and organize the channels you want to follow.

YOUR VIEWING, WITH CONTEXT
See daily and weekly totals, with foreground playback, background audio and browsing shown separately. Review sessions, add purpose labels and keep notes about what you watched. Export a review prompt when you want to reflect on your viewing; Ledger does not connect to an AI service.

CHANNELS YOU CHOOSE
Organize creators into groups and browse their cached uploads. Enable optional YouTube lookups to check for new videos and load thumbnails. Track started and watched videos, or import seen-video evidence from a YouTube history export. Hide recommendations by default and reveal them when you choose.

FOUR THEMES
Choose Retrowave, Frutiger Aero, Light green or Dark green. Animations can be switched off, and supported effects respect reduced-motion preferences.

LOCAL RECORDS AND BACKUPS
History and notes are encrypted in your browser profile. During setup, choose a passphrase and save a recovery key. You can unlock after each browser restart or choose “Open automatically in this browser.” Automatic access saves an unlocking key in the browser profile, so anyone who can use or copy that profile may be able to open Ledger. Full profile backups still need their original passphrase or recovery key.

If you use passphrase-only access, new opted-in viewing can still be recorded in encrypted form while locked. Unlock to review it and use saved groups and watch status.

YOU CHOOSE WHAT CONNECTS
No Ledger account, subscription, developer cloud service or analytics is included. Recording starts only after you choose it during setup. Optional lookups and images send individual video/channel identifiers and requests directly to YouTube or Google; your notes and complete history database are not uploaded. Optional Watch Later cleanup requires separate consent and confirmation before removing selected videos from your YouTube list.

Individual day, group and review exports are readable files you choose to create and share. Only full profile backups are encrypted. Existing Firefox releases cannot open encrypted Chrome backups. This release does not include cross-browser sync or require a companion app.

Ledger is independent and is not affiliated with or endorsed by YouTube or Google. YouTube feeds and page layouts can change, so cached uploads may be incomplete or temporarily out of date.

SCREENSHOT GUIDE
1. Retrowave overview: see foreground viewing, background audio and browsing at a glance.
2. Frutiger Aero overview: explore your viewing patterns in a brighter theme.
3. Light green history: review sessions and add purpose labels.
4. Dark green settings: find appearance, YouTube controls, access and backup options in four categories.
5. Encrypted Ledger: choose automatic browser access or passphrase-only access.
Screenshots use example activity, not a real person's viewing history.

## Listing fields

- Language: English
- Category suggestion: Productivity / Workflow & Planning (choose the closest category offered by the current dashboard)
- Price: Free
- Homepage: https://cabe9.github.io/youtube-ledger/ (deployed and verified October 4, 2026)
- Support: https://github.com/cabe9/youtube-ledger/issues
- Privacy policy intended URL: https://cabe9.github.io/youtube-ledger/privacy-chrome.html
- Privacy policy source: `docs/privacy-chrome.html`. Deployed from commit `1d22ce1` and anonymously verified HTTP 200 on October 4, 2026. The hosted and bundled policies match this file byte for byte.
- Icon: `store-assets/icon-128.png` — the existing green play-and-list mark.
- Small promotional image: `store-assets/promo-small-440x280.png`.
- Screenshots: the five numbered PNGs in `store-assets/`, with corresponding text in `CAPTIONS.txt`. They use synthetic example activity and showcase all four themes.
- Distribution suggestion: public, retain the publisher’s chosen publication mode when resubmitting.

## Single purpose

Help people understand and organize their YouTube viewing through a local activity record, channel groups and viewing controls.

## Permission justifications

| Manifest permission | Text for the dashboard |
| --- | --- |
| `storage` | Keep trusted, memory-only session state for the encrypted profile, temporary queues and undo; migrate older Ledger records into encrypted IndexedDB. Local settings and history support the extension's viewing record and organization features. |
| Host access: `https://www.youtube.com/*`, `https://m.youtube.com/*` | Observe supported YouTube playback and page activity after setup consent; provide channel groups, watch status and recommendation controls. Optional public metadata lookups use these same hosts. No unrelated websites or general browser history are accessed. |

The store build has no `nativeMessaging`, `history`, `tabs`, `scripting`, `downloads`, `webRequest` or broad all-site permission. The existing YouTube host permissions allow the specific tab queries it needs.

## Remote code

Select **No, I am not using remote code.** JavaScript, DOMPurify and the GIF decoder are packaged with the extension. Remote YouTube responses are parsed as data. The extension does not evaluate downloaded scripts, and its extension-page CSP permits scripts only from its own package.

## Privacy practices: proposed selections

Verify the live form wording before saving. Local processing still counts as handling data under Google's policy.

| Data category | Select? | What Ledger handles |
| --- | --- | --- |
| Web history | Yes | Supported YouTube video/page addresses, titles and viewing records; no general browser-history API. |
| User activity | Yes | Playback/browsing durations, watch progress, recommendation actions, grouping and preferences. |
| Website content | Yes | Public video/channel metadata, loaded progress/history evidence, chosen local files and user-entered notes or review text. |
| Authentication information | Yes | Locally entered vault passphrase/recovery key and protected key material; no YouTube account password or cookie access. |
| Personally identifiable information | No dedicated collection | Ledger has no account/name/email/address form. Public creator names are metadata. A user could voluntarily put personal information in free-text notes; do not imply Ledger prevents that. |
| Health information, financial/payment information, personal communications, location | No dedicated collection | No health, payment, messaging or location feature. Notes can contain whatever the user enters. Browser time zone and ordinary network IP disclosure are covered by the policy. |

Certifications supported by the implementation and policy:

- User data is not sold or transferred to third parties outside the permitted use cases.
- User data is not used or transferred for purposes unrelated to Ledger's stated single purpose.
- User data is not used or transferred to determine creditworthiness or for lending purposes.

The developer receives no automated upload of history, notes, credentials or analytics. Do not select “no user data” merely because the records remain local.

## Reviewer instructions

See `REVIEWER-INSTRUCTIONS.md` for the complete first-run, permission, recording, restart and backup test steps. No credentials or access to a developer service are required. All accounts and passphrases in a review can be the reviewer's own disposable test choices.

## Sources checked

- [Privacy fields and permission justifications](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [User Data FAQ, including local handling and secure storage](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Store image requirements](https://developer.chrome.com/docs/webstore/images)
- [Publication and deferred publication](https://developer.chrome.com/docs/webstore/publish)

These materials describe the implementation; they do not claim Google has approved the extension or its automatic-access design.
