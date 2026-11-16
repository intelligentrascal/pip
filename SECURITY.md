# Security policy

Pip is experimental. The newest release is the 0.1.0-alpha.2 alpha; there is no stable release or guaranteed response time yet.
Security fixes target the current source version and the newest alpha; do not assume older snapshots are
supported. The released app is signed with a Developer ID and notarized by Apple. The developer build is unsigned.

## Report privately

Do not open a public issue with an exploit, credential, personal data, database,
backup, private path or unredacted screenshot. Use the public GitHub project's
Security → Report a vulnerability form, which opens a private report; private
vulnerability reporting is enabled on the project. If that form is unavailable,
withhold sensitive details rather than posting them publicly. No personal contact
address is offered.

Include the affected version, a minimal disposable reproduction, expected and actual
behavior, impact and the isolation used. Never send real keys or personal state.
Maintainers should acknowledge privately, reproduce with disposable data, agree a
fix/disclosure plan and publish only redacted information after review.

## Boundaries and limits

See [privacy](docs/PRIVACY.md). Local storage is not encrypted; provider sharing,
public web access and browser handoff each have limits. Allow is not blanket
permission to act. Do not interpret a screenshot, successful fixture or unsigned
build as proof of universal safety.

Security-sensitive changes require maintainer review. Hosted checks cannot prevent
a secret's first exposure: local disclosure checks and exact-content review must
happen before any public push. Never upload development app bundles or raw traces.
