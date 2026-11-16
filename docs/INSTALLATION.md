# Build from source

To use Pip, download the signed and notarized Apple-silicon app from the
[releases page](https://github.com/intelligentrascal/pip/releases) or run
`brew install --cask intelligentrascal/tap/pip-house-elf`. See the README's Install section.
This page is for building from source: an **unsigned, source-dependent developer build**.
There is no network installer or login item. Keep the project folder and its dependencies in
place after building.

The release app, its ZIP and disk image and in-app updates are built and checked locally with
`python3 scripts/release.py` and signed with `python3 scripts/sign_release.py`; that path is
described in [Releasing and updating](RELEASING.md).

## Requirements

- macOS: the Swift package declares macOS 14 as its minimum. A declaration is not
  proof that every feature has been tested on macOS 14.
- Apple command-line developer tools with Swift 6 or newer (the package declares
  Swift tools 6.0; the tested compiler is listed below).
- Node **22.19 or newer**, npm and Python 3.
- Google Chrome for task browsing and the UI test suite.
- A ChatGPT plan, OpenRouter or DeepSeek account only if you choose that provider;
  local remembered facts do not require an AI account.

The preparation Mac runs macOS 26.5.2 on an Apple M1 Pro with 32 GiB memory. It has
Node 22.23.2, npm 10.9.8, Python 3.14.5 and Swift 6.3.2. The fresh-profile native
memory capture passed on that environment. A provisional source-only export also
passed a fresh local clone, dependency installation, host/type checks, unsigned
build, both Swift interface checks and one isolated native focus journey. The
launcher-help test intercepted opening; the real cloned app used the isolated
project launcher. This is not a compatibility matrix or macOS 14 acceptance.
That earlier clone predates the now-merged ChatGPT integration. Final validation
of the reconciled source package remains pending; the earlier result is not a
fresh build or native-launch receipt for these merged bytes.

## Local checkout

Start in a reviewed Pip source checkout. The commands below build locally; they
do not download a portable app or publish files.

```sh
npm ci --ignore-scripts
npm run check
npm run build
npm start
```

The build creates `build/Pip.app` without signing, installation, Gatekeeper changes,
Keychain access, permission requests or login registration. Its runtime paths and
dependency link are specific to the build machine. **Do not redistribute this app.**

## First use, without an account

1. Choose **Summon Pip** from the menu bar, or press **Command–Shift–E**.
2. Choose **More → Remember**, enter a disposable fact such as “For this demo, I prefer
   tea.”, then choose **Review save**. Check the exact text before **Save fact**.
3. Open **More → Settings → Remembered facts**. Edit and Forget require confirmation; Forget
   is not secure deletion. A fresh profile contains no sample facts.
4. In **Settings → Magic**, choose Calm, Balanced (the default) or Rich to set how much
   light is drawn around Pip. Reduce Motion in System Settings turns every effect off.
5. Press Escape to hide Pip. Summon it again; an unfinished draft should remain.
6. In Settings choose **Mac access** and read what each of the six permissions is for
   before choosing **Set up Mac access**. That setup asks macOS once, in order, with
   each permission's own prompt or System Settings pane; only you can grant. Pip never
   re-asks on later launches. Skip it if you do not want the Mac abilities yet — a tool
   that is not allowed says so plainly.

Settings lets you choose a different Command–Shift letter when a shortcut conflicts.
Before submitting AI work, review its provider's Allow screen. No provider is needed
for the memory tutorial. Follow [privacy](PRIVACY.md) for what may leave the Mac.

## Validation and proof limits

```sh
npm run check
swift run PipCoreChecks
swift run PipDictationChecks
python3 tests/publication-export.test.py
python3 tests/launch-help.test.py
npm run test:ui
```

Build before running UI or launcher-help tests. The launcher-help check intercepts
native opening and cannot open a native window. UI tests use a temporary loopback
server; the ordinary native app uses a private pipe rather than a listening service. Native
checks are executable interface checks, not a claim that `swift test` passed.
Use isolated profiles and external log/output folders for tests. Do not run live
provider or device probes as part of ordinary setup.

See [troubleshooting](TROUBLESHOOTING.md), [status](STATUS.md) and
[contributing](../CONTRIBUTING.md).
