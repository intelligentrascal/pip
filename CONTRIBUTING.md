# Contributing to Pip

Pip is an experimental, source-built macOS companion. Small, reviewable changes
with realistic isolated tests are welcome. Read the [documentation](docs/README.md)
and [privacy boundary](docs/PRIVACY.md) before proposing a new integration.

## Develop locally

Use macOS with Apple command-line developer tools, Node 22.19+ and npm, Python 3,
and Chrome for the task browser and UI tests. See [installation](docs/INSTALLATION.md).

```sh
npm ci --ignore-scripts
npm run check
npm run build
swift run PipCoreChecks
swift run PipDictationChecks
python3 tests/publication-export.test.py
python3 tests/launch-help.test.py      # Native opening is intercepted; no window opens
npm run test:ui
```

The build is unsigned and source-dependent. Do not sign, change Gatekeeper, add a
login item or use production state to make a test pass. Automated tests use isolated
profiles; never put a key, personal fact or real account into a fixture. Live provider,
microphone, screen or device checks need separate consent and must state proof limits.

## Optional live ChatGPT validation

This is not ordinary setup or an account-free test. Obtain explicit account-owner
permission for sign-in, the exact live request and allowance use before either
phase. The environment flag below records an already-authorized check; it does
not grant permission. Allocate the native window separately and keep logs private.

The first phase opens an isolated Pip Allow screen and prepares its ChatGPT row.
The account owner chooses Continue with ChatGPT and completes OpenAI’s page. It
closes after connection without typing or sending a model request:

```sh
PIP_CHATGPT_LIVE_ALLOWED=1 PIP_PROBE_OUTPUT=/absolute/outside-project/chatgpt-sign-in \
  PIP_TEST_ROOT=/absolute/outside-project/temp python3 scripts/validate-chatgpt-native.py
```

The second phase uses the same `isolatedHome` from the first phase’s private
`launch.json`. It sends only the approved public-documentation request through
Pip’s private service pipe, without new sign-in, keyboard injection or taking key
focus. It refuses a profile with existing work or memories rather than replaying
an uncertain request. Only the service reads its saved credential:

```sh
PIP_CHATGPT_LIVE_ALLOWED=1 PIP_CHATGPT_TEST_HOME=/the/same/isolatedHome \
  PIP_PROBE_OUTPUT=/absolute/outside-project/chatgpt-draft \
  PIP_TEST_ROOT=/absolute/outside-project/temp python3 scripts/validate-chatgpt-native.py
```

These are editable path examples, not commands to run against personal state.
The sign-in phase captures Pip’s Settings, not OpenAI’s sign-in page; the draft
phase captures generated output. Neither proves physical keyboard input or universal
workspace eligibility; see [status](docs/STATUS.md). Existing untagged-input guards
remain unchanged.

## Propose a change

1. Describe the user intent, current failure and smallest correction. Discuss large
   changes before implementing them; avoid cosmetic source-tree migrations.
2. Add behavior coverage at the cheapest layer that sees the failure. Use real
   envelopes and realistic data, not source-text assertions. One test owns each fact.
3. Run affected end-to-end journeys as well as the local gate. Changed unit/UI tests
   need ten consecutive passes without retries; stop and diagnose the first failure.
4. Update affected docs, status claims and the exact publication manifest. Never
   auto-approve a new filename just to make the export pass.
5. Use conventional commit subjects such as `fix(browser): retain reviewed page`.
   Submit a focused PR describing evidence, limits and risk. Do not attach raw traces.

Maintainers review workflow, provider, credential, native bridge, privacy and export
changes explicitly. New provider support must preserve Allow and effect approvals;
connection is not proof of live capability. Dependency changes need license and
advisory review. Do not execute an untrusted contribution against personal state.

## Keep reports private when needed

Never post credentials, database files, backups, full logs, personal paths or
unredacted screenshots in issues. Use [security reporting](SECURITY.md) for a
vulnerability. Follow the [code of conduct](CODE_OF_CONDUCT.md).

## Licensing contributions

Submit only material you have the right to contribute. Original code/docs use MIT;
eligible original artwork uses CC BY 4.0 with provenance and credit. Identify any
third-party or generated material and its applicable terms. No exclusive copyright
or service endorsement is implied by accepting generated artwork.

Publication is a separate operation; see the [local preparation gates](docs/PUBLICATION.md).
