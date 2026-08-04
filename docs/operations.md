# Operations

Use the copyable installation and reconciliation workflow in `bootstrap/README.md`.

Public target changes are normal Git changes to `catalog-info.yaml`, the root bootstrap
coordinates, or the ApplicationSet inventory. Commit and push them before asking Argo CD to
reconcile. Credential rotation updates ignored `bootstrap/secrets.env`, recreates
`platform-secrets`, and lets ESO refresh workload-local Secrets.

Application removal is intentionally conservative: the ApplicationSet can create and update but
does not delete Applications. Use a component-specific, reviewed uninstall procedure for already
installed resources.
