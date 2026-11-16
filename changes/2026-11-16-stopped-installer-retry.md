---
rank: small
---
- **Running the installer again after a Termux close no longer fails at Hermes.** A Termux closed during the Hermes update left a git lock file behind, and the next run stopped with "could not write index"; the installer now removes such locks once they are over 2 minutes old. The card for a stopped installer also stops counting its time where the installer was last heard. Found on an emulator; checked with the installer script tests and the browser tests.
