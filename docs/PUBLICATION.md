# Publication preparation

**Local preparation only. Nothing in this project authorizes uploading it.**

The intended public destination is `intelligentrascal/pip`. The accepted choice is
MIT for original code and documentation, CC BY 4.0 for eligible original artwork,
and GitHub-handle attribution only. No external ownership restrictions are known
to the maintainer. That statement is not third-party rights clearance.

## Preserve the original

Keep the existing local project, commits, branches, reflogs and stashes untouched.
Do not push this project's history. A future public project starts with a new root
commit from reviewed files in a **separate directory**, not a rewritten local branch.
Do not use a mirror, all-branch push, automatic tag push or folder synchronization.
Local state, credentials, backups and development app bundles never belong there.

## Candidate export

`scripts/publication-export.py` reads committed Git blobs, not the working folder.
`publication-files.json` must account for every tracked path: either an exact include
or an exclusion with a reason. New tracked files stop the export until reviewed.
Symlinks, submodules, unexpected paths, case/Unicode-colliding names and common
state/build/archive paths are rejected. The private report cannot be written into
the candidate directory, including through case-insensitive destination aliases.
Known disclosure and email-shaped patterns stop export without printing matched contents. Reserved example-domain and GitHub no-reply addresses are not
personal-contact findings. A reviewed false positive needs a reason and exact file
hash in `reviewedFindings`; changed bytes invalidate the exception. No broad
pattern exemption is allowed. These checks are bounded; they are not a complete
secret detector or legal review.

Run from the source project, with new private output paths outside it:

```sh
python3 scripts/publication-export.py --revision HEAD \
  --output "$CANDIDATE_DIR" --report "$REVIEW_REPORT"
```

Set both variables to new absolute paths. The destination must not already exist.
The output has no `.git`, remote, historical commit, tag or author identity. The
separate report records the source commit, included byte hashes, executable modes,
exclusions and a digest binding the exact tree. It always says publication is not
approved. Retain the report privately; do not include it in public documentation.
No candidate is canonical, and no manifest update is automatic approval.

## Required final review

All boxes are gates, not claims that checks have passed:

- [ ] Confirm the reviewed source includes the native provider-envelope correction
      and merged ChatGPT integration; reconcile overlapping documentation against
      actual proof, and retain the merged cancellation and saved-connection repairs
      with their proof limits.
- [ ] Inspect every candidate filename and byte, excluded-file reasons, dependency
      notices, fixture attributions, and license obligations. Review personal paths,
      account identifiers, URLs, keys, tokens, private narratives and media metadata.
- [ ] Retain recorded artwork provenance, attribution, applicable-term limitations
      and qualified license scope without claiming blanket generated-output rights.
      No further generated-art eligibility investigation is required by this
      preparation checklist; privacy checks and exact-content public consent remain.
- [ ] Capture only Pip's own window in a fresh disposable profile: hero, Settings /
      Allow, a memory review/save/list GIF and a 6–10 second Balanced summon and
      effects recording (MP4 and GIF), each with a static equivalent.
      Inspect every frame, remove personal capture metadata, preserve required
      provenance markings and label fixture-driven results. Keep
      masters private and approve each committed derivative by hash.
- [ ] Verify README rendering, local links, GIF/static parity, installation from a
      clean clone, launch behavior and accurate limitations. Record actual OS and
      hardware separately from the declared macOS minimum.
- [ ] Run `npm ci --ignore-scripts`, `npm run check`, unsigned `npm run build`,
      `swift run PipCoreChecks`, `swift run PipDictationChecks` and affected UI
      journeys. Changed tests require ten consecutive passes without retries.
      Inspect dependency advisories; do not expose raw reports or traces.
- [ ] Re-export the settled committed source. Inspect its exact tree and bind the
      captain's final publication review to its digest and approved media hashes.
      Any later source/media change invalidates that review.

## Distinct public-setup successor

Only after that exact-content review may a separate authorized task create the
public project. It must confirm destination availability and the handle's GitHub
no-reply identity rather than exposing a personal email. GitHub's public user record
currently identifies intelligentrascal as account 63400203; the corresponding
no-reply address is `63400203+intelligentrascal@users.noreply.github.com`. Reconfirm
the account identity before creating the public root commit.

Create fresh history in the separate approved candidate; inspect every reachable
object, author/committer identity, message, ref and tag before the first upload.
Do not copy original `.git` metadata, old branches, stashes or recovery objects.
No signing or credential-store access is authorized by this document.

Use one canonical code history after a coordinated handover. Require reviewed PRs
and passing checks; protect the default branch against force pushes and deletion.
Use explicit branch pushes only. Enable available free public secret scanning,
push protection, dependency alerts and private vulnerability reporting; verify
actual settings. Disable unnecessary Pages/wiki features. Hosted checks run after
exposure and never replace a local pre-push disclosure review.

Workflows need read-only permissions, immutable action pins, isolated disposable
data, no provider secrets, no privileged fork execution and no personal-Mac
self-hosted runners. Review workflow and security-sensitive changes through the
maintainer. Confirm a fresh GitHub clone matches the approved tree, public refs and
identities are clean, protections apply and the first hosted checks pass.

Signed downloads, notarization, new integrations, paid demonstrations, key rotation
without a finding and rewriting or deleting the original history are out of scope.
