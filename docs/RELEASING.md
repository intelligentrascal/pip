# Releasing and updating Pip

Pip has two ways to be built. `npm run build` makes the **developer build**: unsigned,
linked to this working copy's `node_modules` and to the Node on the machine that
built it. `python3 scripts/release.py package` makes the **release app**: one
self-contained Apple-silicon `Pip.app` with its own Node runtime and only the
production dependencies. Nothing in the release app names the machine that built it.

Everything below runs locally. `release.py` never signs, notarizes, publishes, pushes or
reads the Keychain; signing is the separate `sign_release.py`, and publishing needs the
maintainer's own Apple account and consent (see the last section).

## What the release app contains

| Piece | Where | Notes |
| --- | --- | --- |
| Pip (AppKit and WebKit host) | `Contents/MacOS/Pip` | Built for arm64, macOS 14 or later, with no debug paths |
| Node runtime | `Contents/MacOS/node` | The official Node binary pinned in `release/node-runtime.json` by version and SHA-256 |
| Local service and window | `Contents/Resources/runtime`, `web` | Resolved relative to the app |
| Production dependencies | `Contents/Resources/node_modules` | From `package-lock.json`, `--omit=dev --ignore-scripts`; the universal Peekaboo helper is thinned to arm64 |
| Licenses | `Contents/Resources/licenses` | Node's license, every dependency's license files, `npm-inventory.json`, Pip's license and notices |
| Icon | `Contents/Resources/Pip.icns` | Made from the Curious Hearth artwork by `release/icon/make-icon.py` |

Chrome stays optional. Pip never installs a browser, Node, Python or Swift.

Intel Macs are not supported. The minimum macOS is declared as 14.0 in
`release/release.json`; it has not been tested on an older system than the one the
package was built on, so state only what has been proved.

## Build, check and rehearse locally

```sh
python3 scripts/release.py package --rehearsal   # build/release/artifacts: ZIP, DMG, SHA256SUMS, release-manifest.json
python3 scripts/release.py verify build/release/artifacts --allow-unsigned
python3 scripts/release.py cask build/release/artifacts     # pip-house-elf.rb for a Homebrew tap
PIP_TEST_ROOT=/absolute/outside-project/temp \
  python3 scripts/release.py rehearse build/release/artifacts --output /absolute/outside-project/evidence
```

`package` refuses an app that is not self-contained: a symbolic link, a library outside
macOS, a slice that is not arm64, a development tool, a missing production dependency,
a Node that is not the pinned one, or the build machine's folder names. `--rehearsal`
accepts a build with no update key. Without it, `package` and `verify` also refuse
that, and refuse an unsigned app unless `--allow-unsigned` is given.

`verify` checks a folder of downloads the way a person's Mac receives them: the files
against `SHA256SUMS` and the manifest, the ZIP's app and the DMG's app against the same
tree hash, the app's identity and version, and its Node. `--fetch <base URL>` downloads
the files from where they were published first, with no credentials.

`rehearse` runs in disposable folders and isolated Pip homes. `launch` starts the app
from the ZIP with only `/usr/bin:/bin` on `PATH` and checks that its bundled Node runs
the service and the native checks pass. `update` runs the updater end to end against a
feed signed with a throwaway key: a good update, an up-to-date app, a tampered download,
a feed signed by another key and a Homebrew-owned copy.

## In-app updates

Pip menu > **Check for Updates…** reads a signed feed. Nothing is downloaded or
replaced until you choose **Download and restart**, and nothing is checked in the
background.

- The feed (`updates/feed.json`) lists each release's version, channel, minimum macOS,
  chip, download address, SHA-256 and size. `updates/feed.json.sig` is an Ed25519
  signature over the exact bytes of the feed. The public key is in the app's
  `Info.plist` (`PipUpdatePublicKey`, from `release/update-public-key.txt` at build
  time). A build without that key cannot check for updates.
- Pip offers a release only if it is newer than the running version, for arm64, for a
  macOS Pip can run, on the build's channel or a more settled one (`alpha`, `beta`,
  `stable`) and at an `https` address. It never offers a downgrade.
- The download must match the signed size and SHA-256 before it is opened. The app
  inside must be exactly one `Pip.app` with this bundle identifier, the announced
  version, an Apple-silicon executable and no link out of the bundle.
- Pip quits and a script it started replaces the app: it moves the old app aside, puts
  the new one in place and opens it. If the new version does not report that it started
  within 30 seconds, the old app is put back and opened again. Saved work in
  `~/Library/Application Support/Pip` is never touched.
- A copy installed by Homebrew is updated by Homebrew (`brew upgrade --cask
  pip-house-elf`); Pip says so and does not replace it. A copy running from a disk image
  or in a folder you cannot write is told to move or replace manually.

To add a release to the feed, with the private key kept outside the working copy:

```sh
node --import tsx scripts/update-feed.ts keygen --out /absolute/outside-project/keys   # prints the public key
node --import tsx scripts/update-feed.ts add --feed updates/feed.json \
  --key /absolute/outside-project/keys/pip-update-signing-key.txt \
  --zip build/release/artifacts/Pip-0.1.0-alpha.1-arm64.zip --version 0.1.0-alpha.1 \
  --channel alpha --minimum-system 14.0 --architecture arm64 \
  --url https://github.com/intelligentrascal/pip/releases/download/v0.1.0-alpha.1/Pip-0.1.0-alpha.1-arm64.zip \
  --notes "First alpha."
```

A version already in the feed with different bytes is refused; publish a new version
instead. The private key must be provisioned through protected entry by the maintainer;
it is never printed or placed in the project.

## Homebrew

`release.py cask` writes `pip-house-elf.rb` for the ZIP it packaged: the cask token,
the release URL, the ZIP's SHA-256, Apple silicon and macOS 14 or later. It has no
`zap` stanza, so no Homebrew command deletes saved work. It belongs in a tap such as
`intelligentrascal/homebrew-tap` once that project exists. The cask must point at the
same notarized ZIP that was published, so generate it only after publication.

## Sign, notarize and publish

Signing and publishing need the maintainer's own Apple account and consent each time.

1. A Developer ID Application certificate, a Team ID and a `notarytool` Keychain profile
   the maintainer stored themselves. No password or key is ever on a command line.
2. The update-signing key lives outside the project (its public half is in
   `release/update-public-key.txt`). Build the release app with it embedded:
   `python3 scripts/release.py package`.
3. Sign, notarize and staple, then make the final ZIP and DMG:

   ```sh
   python3 scripts/sign_release.py sign --identity "Developer ID Application: …" \
     --notary-profile <profile> --journal /absolute/outside-project/notarization
   python3 scripts/release.py verify build/release/artifacts
   ```

   It signs each nested program, then the app, with hardened runtime and secure timestamps,
   submits the app and then the DMG to Apple, journals each submission as soon as Apple
   answers, and staples both. An interrupted run resumes with `--resume`; it never submits
   the same bytes twice. `sign_release.py inspect <folder>` re-checks a signed package.
4. Add the release to `updates/feed.json` (above), commit, and publish the reviewed
   export. Create the GitHub release `v<version>` with the ZIP, the DMG, `SHA256SUMS` and
   `release-manifest.json`, marked as a prerelease for an alpha.
5. Read the release back with `release.py verify build/release/artifacts --fetch <download base URL>`,
   then write the cask with `release.py cask` and put it in the tap.

A published version is never changed; different bytes need a new version.
Hosted workflows are manual-start only; every check runs locally. Intel Macs and macOS
older than the one the package was built on are not claimed.
