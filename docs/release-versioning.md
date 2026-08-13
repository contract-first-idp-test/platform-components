# Release policy

The repositories are independently versioned:

```text
software-templates -> developer-charts -> platform-components
software-templates ----------------------> platform-components
```

A repository version describes changes to the contract that repository owns.
`platform-components` owns the PlatformTarget and shared platform contract.

- Patch: implementation fix; dependency requirements must not change.
- Minor: additive capability; dependency minimums may increase.
- Major: incompatible owned-contract change that may require migration.

Root `release.yaml` is authoritative. The platform fork remains the implementation and
installation configuration on `main`. Its PlatformTarget selects software-templates and
developer-charts independently using an exact immutable `revision` plus a semantic `version`.
Selecting a compatible dependency patch is a normal platform configuration commit and does not
require a platform-components release. Existing Domain Applications may retain their creation-time
chart revision; changing that lifecycle is a separate concern.

## Release procedure

1. Choose SemVer from changes to this repository's owned contract.
2. Update `release.yaml` and repository-owned version metadata.
3. Run `make release-check`.
4. Run applicable sibling compatibility checks.
5. Commit and push.
6. Create and push the exact `vX.Y.Z` tag.
7. Verify tag CI.
8. Update platform `main` when selecting a different exact compatible dependency tag.

The validator uses `node-semver`, requires tag/version equality and monotonic versions, and rejects
a patch whose dependency requirements differ from the previous release.
