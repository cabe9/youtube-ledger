# Chrome 0.18.1 publication checklist

Version 0.18.1 was submitted on October 9, 2026 and the dashboard confirms **Pending review**. Automatic publication after approval is enabled. See `dist/chrome-release-candidate/0.18.1/STORE-SUBMISSION-RECEIPT.json`.

Version 0.18.0 was rejected on October 8 for the unused `alarms` permission. The store build now removes it and its unused compatibility adapter; see `PERMISSIONS.md`. The only changed package files are `manifest.json`, `compat.js` and `INSTALL.txt`. The privacy policy remains revision 0.18.0 because data handling is unchanged.

## Prepared

- Browser-only store variant named **YouTube Ledger**, version 0.18.1. The development preview remains at 0.18.0.
- No companion installation, native messaging or automatic cross-browser sync in the public package.
- Passphrase protection and optional browser automatic access with explicit consent and matching disclosures.
- Recovery fallback for a damaged temporary session key; private review instructions excluded from content-script settings messages.
- Dedicated Chrome privacy policy, byte-identical to the bundled document.
- Store name, description, single-purpose statement, permission justifications, proposed privacy answers and reviewer instructions.
- Correct green store icon, small promotional image, and five 1280×800 screenshots showing all four themes and the unlock screen. Captions are included in the listing's numbered screenshot guide because the Chrome form has no separate caption fields. All example activity is synthetic.
- Deterministic ZIP generation and exact file allowlist, plus checks for privacy identity, permissions, script paths and frozen Firefox submission hashes.
- macOS and Windows x64 each passed all eight validation phases on source commit `6a98c9e`. [Windows run and logs](https://github.com/cabe9/youtube-ledger/actions/runs/38030980688). Both build the same ZIP, SHA-256 `72fab7a756ebf2df6dfa1ae21046c8a3f3babe1b78c0a8780401408a23ba1ae7`. The installed-extension check confirms only `storage` and the two YouTube hosts are granted.
- Hosted Chrome policy and browser-specific homepage links deployed to main in `1d22ce1`; both verified anonymously as HTTP 200 with byte-for-byte source matches on October 4, 2026. Only those two site files were deployed.

## Submission verified

- Publisher contact email is verified; no verification blocker was shown.
- Draft package 0.18.1 shows only `storage` and host access. The old alarms justification is gone; the storage explanation identifies the actual Chrome API calls.
- The existing green icon, five captioned theme screenshots, category, disclosures and Chrome privacy URL are retained.
- Reviewer instructions explain the rejection correction and link to the now-published instructions at source commit `6a98c9e`.
- The dashboard confirmed successful submission and **Pending review**. Automatic publication after approval is enabled. No appeal was filed.
- Historical 0.18.0 files and Firefox submission archives are unchanged. Google has not yet approved 0.18.1; local tests do not guarantee acceptance.

## Installation and existing users

The same store extension package is intended for Chrome on Windows and macOS. No companion app is required. Windows x64 was tested on GitHub’s Windows Server 2025 runner. Windows ARM and Linux are not tested in this release pass.

An unpacked install and the eventual Store install can have different extension IDs and therefore separate storage. Export a full profile before removing an existing installation; install the public extension, complete setup, import the backup and verify the data first. Older readable backups can be imported. Encrypted Chrome backups need the credential used when exported, and existing Firefox releases cannot open them.

A version-only update preserving the same extension ID is tested separately from migration. The lifecycle rehearsal increments a copied candidate's version; it does not pretend to reproduce every historical release. The migration test separately verifies readable legacy records becoming encrypted.

## Reproduction

```sh
npm install --ignore-scripts --no-audit --no-fund --no-package-lock
npx --no-install playwright install chromium
python3 chrome-vault/validate-release.py
node scripts/chrome-store-assets.cjs --store
python3 scripts/check-chrome-release.py --with-assets
```

On Windows use `python` instead of `python3`. Test scripts create and delete disposable profiles. The validation report records the OS and exact ZIP hash. Do not run these tests inside your everyday browser profile. Do not upload profiles or private exports as CI artifacts.
