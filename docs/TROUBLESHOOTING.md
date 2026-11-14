# Troubleshooting

Use disposable data when reproducing a problem. Never attach your profile,
credentials, database, backups or full logs to a public report.

## Pip does not appear

Use **Summon Pip** in the menu bar. If it works but the shortcut does not, another
app may own that shortcut; choose a different Command–Shift letter in Settings.
Do not grant Accessibility or Screen Recording just to work around an unproved
shortcut. Physical global hotkey and ordinary Spaces retain proof limits.

## The build fails or the app stops after moving the folder

Check the [requirements](INSTALLATION.md). The development app needs its original
project and dependencies. From that reviewed checkout, run:

```sh
node --version
python3 --version
swift --version
npm ci --ignore-scripts
npm run build
```

Do not disable Gatekeeper, sign the app or download an unreviewed binary to make a
local build pass. Report a minimal redacted failure, not an archive of the app.

## A request cannot get an answer

Check Settings: the selected provider must be allowed and connected. Review what
Allow shares before enabling it. A disconnected provider should preserve your
request rather than fabricate an answer. One already-allowed named backup may
answer an initial availability failure; no third provider is tried. A partial
answer or continuation limit waits for reviewed Continue, not a hidden retry.
Never paste a key into the ordinary input or a public issue.

## Talk or screen context is unavailable

Typing is the fallback. Live dictation needs existing device grants and on-device
support; summoning starts neither microphone nor screen capture. Native screen
capture, preview/crop/share and live understanding are unfinished or unproved.
Do not change system permissions as part of a source installation check.

## Browser or UI checks cannot launch

Install Chrome through your normal reviewed installation process if you want the
browser features. Build first, then run `npm run test:ui`. The tests use an isolated
loopback service and explicit test profiles, not your personal browser session.
Do not connect a personal account or production state to repair an offline fixture.
Stop at the first failed repeated run and diagnose it; do not add a retry or sleep.

## Why did Forget not erase every copy?

Forget makes a fact inactive for future context. Historical records and backups
may retain it; a provider may already have received it. See [privacy](PRIVACY.md).
Pip makes no secure-erasure guarantee.

## How can I share a useful bug report safely?

Describe what you expected and what happened, the source version, OS and a minimal
reproduction using disposable text. Redact personal paths and screenshots. For a
suspected vulnerability, follow [security reporting](../SECURITY.md), not a public
issue with sensitive details.
