---
rank: small
---
- **Security updates for the parts that display replies.** The app now ships DOMPurify 3.4.17 (used by diagrams),
  KaTeX 0.18 (maths) and only zod 4.6.7, which fix published security flaws in the older versions. The test tools
  (Vitest 4, Vite 7.3.8, happy-dom 21) were updated too. Checked with the typecheck, unit tests and browser tests; not
  tried on a phone.
