# Release and compatibility model

The three repositories are independently versioned:

```text
software-templates -> developer-charts -> platform-components
software-templates ----------------------> platform-components
```

`platform-components` owns the PlatformTarget/platform contract. Its root `release.yaml` is
authoritative and starts the meaningful release history at `1.0.0`. It does not declare the
consumer repositories as dependencies. The PlatformTarget separately records the exact
developer-charts runtime selection and the exact software-templates publication selection.

A patch fixes implementation behavior without intentionally changing the owned contract and must
not change dependency compatibility requirements. A minor adds capability and may raise dependency
minimums. A major is an incompatible change to the owned contract and may require migration. A
patch release in one repository does not require a release in another repository when the existing
compatibility ranges already include it.

## Distribution and configuration

Released distribution code uses an immutable exact tag. Installation state uses a writable branch:

```yaml
distribution:
  version: "1.0.0"
  revision: "v1.0.0"
configuration:
  revision: "workshop"
tenantAdmission:
  branch: "workshop"
dependencies:
  developerCharts:
    version: "1.0.0"
    revision: "v1.0.0"
  softwareTemplates:
    version: "1.0.0"
    revision: "v1.0.0"
```

`platform-configuration` follows `workshop`; `platform-root` and platform implementation
Applications follow the immutable distribution tag. Domain Applications follow the exact
developer-charts revision selected by the PlatformTarget. A release tag is never a pull-request
target, and floating release branches or wildcard Argo CD revisions are not supported.

## Release procedure

1. Decide this repository's SemVer from changes to the PlatformTarget/platform contract.
2. Update `release.yaml` and any derived installation metadata.
3. Run `make release-check`.
4. Run any required cross-repository compatibility checks.
5. Commit and push the verified release candidate.
6. Create the exact `vX.Y.Z` tag at that commit.
7. Push the tag and verify the tag-triggered GitHub Actions gate.
8. Update the writable platform configuration branch to desired exact compatible tags.

The validator uses `node-semver`, checks tag/version consistency and monotonicity, rejects patch
dependency changes, and verifies the checked-in distribution/configuration metadata. GitHub Actions
independently repeats `make release-check` for every `v*` tag.
