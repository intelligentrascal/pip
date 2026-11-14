# Privacy and trust boundaries

Pip keeps its application state on your Mac. That does **not** mean everything
stays local, that storage is encrypted, or that every integration is safe for every
kind of information.

## Local state

The normal profile is `~/Library/Application Support/Pip`. It contains requests,
drafts, remembered facts, projects, continuity records and backups. The service
uses SQLite with one writer. Restrictive file permissions reduce exposure to other
users; they are not encryption and cannot protect an already-compromised account.
Migration backups and operating-system backups may retain old data.

**Forget** makes a remembered fact inactive for future use. It does not securely
erase historical state, backups or copies already sent elsewhere. Removing a
provider credential does not retract earlier requests from that provider.

Provider credentials use a separate service-owned mode-0600 file. The native secure
entry path bypasses the web renderer; credentials are not meant to enter saved
application state, logs, screenshots or model input. Pip does not use Keychain for
this storage. Never include this file in a bug report or source synchronization.

## Provider sharing and billing

Choose **Allow** in Settings before using a provider. Its screen names the request
and approved context it may receive, the destination and who bills. The allowed
context can include approved remembered facts, selected result/project context,
explicitly shared window images when supported, and public page text read for a
task. Permission is renewed when this boundary changes.

For deliberate developer live checks, the legacy `PIP_CLAUDE_ALLOWED=1` launch
flag also allows Claude without the Settings choice. The documented ordinary
launcher does not set it. Do not set it for normal use or an account-free demo;
live checks need separate explicit consent for the account and allowance. This
exception does not allow any other provider.

- **Claude:** uses the installed Claude program through the official Agent SDK.
  Provider authentication and service terms remain separate from Pip's MIT license.
  Do not advertise blanket subscription compatibility or credential intermediation.
- **OpenRouter:** its sign-in flow mints a key. Routing follows your OpenRouter
  account privacy settings; Pip sends no training/retention routing override.
- **DeepSeek:** accepts a key through the native secure field. Its
  [published privacy disclosure](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
  identifies processing/storage in China. That provider policy does not replace
  the downstream app's own privacy explanation. Check current terms before sharing data.
- **ChatGPT:** merged plan access uses OpenAI’s Sign in with ChatGPT preview for
  locally hosted apps. Pip registers its own opaque host identity and verifies
  signed identity plus the account model catalogue before saving credentials in
  the service-owned private file, not the renderer. Requests use the public
  Responses API with the same app-owned tools. Earlier isolated native sign-in
  and a sourced editable draft have live proof, not universal plan/workspace
  eligibility. OpenAI controls eligibility and ChatGPT allowance.

Providers apply their own retention, processing, account and billing terms. Allow
is permission to send the described context, not a guarantee of confidentiality.
Never paste a credential into the ordinary request box.

The merged provider repair checks cancellation before execution and after
credential preparation, and prevents stopped work from falling back to another
provider. Stop still cannot retract information or allowance already used by a
request that was sent.

A token refresh that finds another request already refreshed keeps the saved
connection, and cancelling a sign-in keeps an earlier one. Only Remove deletes a
saved connection. See [status](STATUS.md) for the proof limits of both repairs.

You can choose **one named backup** in Settings; it must already be allowed. It is
used only when the active provider cannot answer at all, not after a partial answer
or a reviewed continuation limit. A backup response identifies its provider and
reason. If it also fails, Pip keeps the request and tries no third provider. This
can share the approved request with a second company and use its allowance.

## Public web and task browser

Public research makes external network requests; destinations can observe ordinary
connection metadata. Opened content is untrusted evidence, not instructions or
permission. Pip's task browser uses an isolated Chrome session, not your existing
personal browser profile. Isolation does not make a website trustworthy.

Take over is an exclusive private handoff for steps only you should perform.
Returning control requires a fresh reading; old page references cannot authorize a
new action. Read-only agent browsing is not permission to submit forms, purchase,
send messages or make account changes. Review consequential effects separately.
Native embedding and private-account journeys retain their documented proof gaps.

## Device and integration limits

Summoning Pip starts neither microphone capture nor screen sharing. Dictation needs
existing device grants and on-device support; typing stays available otherwise.
Screen capture, preview/crop/share and live understanding are unfinished or unproved.
Calendar, Reminders and notifications are not connected. No public README should
present these as completed integrations.

## Public source is not a backup

GitHub synchronization must include only reviewed code, docs and approved media.
Never synchronize a profile, credential, backup, app bundle, trace or personal
capture. Public forks and caches can persist after deletion. See
[publication gates](PUBLICATION.md) and [security reporting](../SECURITY.md).
