# Operations

[Back to the repository overview](../README.md)

Use the copyable [installation and reconciliation workflow](installation.md).

Public target changes are normal Git changes to `catalog-info.yaml`, the root bootstrap
coordinates, or the ApplicationSet inventory. Commit and push them before asking Argo CD to
reconcile. Credential rotation updates ignored `bootstrap/secrets.env`, recreates
`platform-secrets`, and lets ESO refresh workload-local Secrets.

## Developer Hub and Dev Spaces GitHub App rotation

The [workshop App procedure](installation.md#configure-the-cf-idp-github-app) defines the single
credential contract. When rotating it, generate the replacement client secret and/or private key in
the existing GitHub App, update `GITHUB_APP_CLIENT_SECRET` and/or
`GITHUB_APP_PRIVATE_KEY_BASE64` in ignored `bootstrap/secrets.env`, and recreate
`platform-secrets` with the installation command from the workshop guide. ESO sends the shared
client secret to both Developer Hub and Dev Spaces, while it decodes and sends the private key only
to Developer Hub. Wait for both ExternalSecrets to become Ready and repeat the
[GitHub integration checks](validation.md#github-app-integrations) before
revoking the old GitHub credential.

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
