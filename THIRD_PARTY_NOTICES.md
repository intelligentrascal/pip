# Third-party notices

Pip's MIT license applies to original code and documentation, not dependencies,
service access, generated-output rights or third-party fixtures. Dependency
versions and integrity hashes are pinned in `package-lock.json`; installing them
retrieves separately licensed material. The source project does not vendor
`node_modules` or offer the machine-specific development app for redistribution.

## Earendil packages and captured documentation

`@earendil-works/chord`, `@earendil-works/pi-ai` and
`@earendil-works/pi-durable` declare MIT. Their installed packages omit full license
files. The upstream `v1.4.0` root license is reproduced below. Source:
<https://github.com/earendil-works/pi/blob/v1.4.0/LICENSE>.

The captured public README fixtures `tests/fixtures/public-readme-complete.json`
and `tests/fixtures/public-readme.json`, and their browser wrapper, retain upstream
authorship. The complete body matches the upstream durable README exactly at
[the captured source revision](https://github.com/earendil-works/pi/blob/e9c0ff4d84a69773ae16950e6d8cb0ef224e538f/packages/durable/README.md);
the short capture is an exact prefix. That source has the same root MIT notice
reproduced below. Capturing documentation does not make it original Pip content.
Preserve this notice with redistributed copies or substantial portions.

> MIT License
>
> Copyright (c) 2025 Mario Zechner
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Claude SDK and services

The Claude Agent SDK and its platform packages declare separate commercial terms.
They are **not relicensed under Pip's MIT license**, and this project must not
claim every dependency is open-source. Review the installed package's
`LICENSE.md` and current official authentication/service guidance before any
redistribution or subscription-support claim. A source dependency declaration is
not a grant to redistribute a signed or portable application.

## Source dependency inventory

The current lockfile has 230 non-root dependency entries: 154 MIT, 43 Apache-2.0,
14 BSD-3-Clause, seven ISC, one BSD-2-Clause, one 0BSD, one Unlicense and nine Claude
SDK/platform entries referring to the commercial notice described above. This is
an inventory of declarations, not a claim that every dependency is open-source.
The installed macOS Claude SDK/platform notices both point to Anthropic's legal
agreements; the omitted platform binaries are not part of this source export.

No dependency directory, installed binary, generated app bundle or transitive
license file is copied into the public candidate. The copied third-party README
fixtures are covered by the exact matched notice above. A source dependency
reference is not a vendor-code or binary redistribution license.

Preserve applicable copyright notices, complete license text and NOTICE material
whenever redistributing third-party material. Any later bundled release needs its
own installed-package license/NOTICE inventory, including omitted platform terms.
Reconcile this inventory against the settled lockfile before publication; a package
license field alone is not legal clearance.

Browser/software trademarks belong to their respective owners. Naming a provider,
library, model or service implies no sponsorship or endorsement. Artwork eligibility
and generation provenance are separate: see [artwork licensing](assets/LICENSE.md).

**Final package review:** reconcile dependency notices against the settled source
before exact-content publication approval. An advisory scan reporting no known
vulnerabilities does not verify license obligations. Recorded generated-art
limitations remain in the artwork notice; no independent legal clearance is
claimed. Further generated-art eligibility investigation is outside this
preparation scope.
