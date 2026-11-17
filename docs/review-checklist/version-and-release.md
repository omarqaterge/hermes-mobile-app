# Version numbers, signing or release steps

- paths: `^(tools/version-code\.sh|tools/release-gate\.sh|android/build\.sh|\.github/workflows/release\.yml|android/src/com/omarqaterge/hermesmobile/Update\w+\.java)$`

A build number that goes down, or a test build above the installed release, makes the next real update refused on
every phone that has it. The build number comes from `tools/version-code.sh`; a test APK reuses the installed
release's number. No `v*` tag or release from an agent: the owner decides.
