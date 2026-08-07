# Operations

Use the copyable installation and reconciliation workflow in `bootstrap/README.md`.

Public target changes are normal Git changes to `catalog-info.yaml`, the root bootstrap
coordinates, or the ApplicationSet inventory. Commit and push them before asking Argo CD to
reconcile. Credential rotation updates ignored `bootstrap/secrets.env`, recreates
`platform-secrets`, and lets ESO refresh workload-local Secrets.

Application removal is intentionally conservative: the ApplicationSet can create and update but
does not delete Applications. Use a component-specific, reviewed uninstall procedure for already
installed resources.

## Quay bootstrap

On the first installation, the `quay-initialize` Job waits for Quay and creates the configured
initial user at sync wave 5. It remains a one-shot Job with no Kubernetes API access. At sync wave
6, the separate `quay-activate` Job restarts `deployment/registry-quay-app`, so Quay starts with a
valid `BOOTSTRAP_TOKEN_OWNER`. Quay then produces `registry-bootstrap-token`; the existing External
Secrets and Quay Bridge flow carries that token to the integration.

`quay-activate` uses its own namespace-local ServiceAccount. Its Role can only get and patch the
generated `registry-quay-app` Deployment. On an existing installation, the completed
`quay-initialize` Job remains untouched and only the new activation Job runs.
