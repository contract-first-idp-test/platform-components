# Operations

[Back to the repository overview](../README.md)

Use the copyable [installation and reconciliation workflow](installation.md).

Public target changes are normal Git changes to `configuration/catalog-info.yaml`, the bootstrap
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

## Generated credential lifecycle

`ExternalSecret/platform-generated-secrets` uses `CreatedOnce` with an orphaned, retained target.
Ordinary reapply/reconcile does not rotate persisted consumer credentials. Deleting the
ExternalSecret intentionally leaves the target Secret. With the installed ESO 1.2.0, deleting that
target while the `CreatedOnce` ExternalSecret remains does not recreate it. Deleting and recreating
the ExternalSecret restores a target but generates a new value, which can desynchronize persisted
consumers. Back up or rotate through a component-specific procedure before either deletion.

Domain publisher credentials follow a different lifecycle: the Domain Application owns their
generators, canonical Secrets, Keycloak projections, and clients. Domain deletion removes that
identity boundary, and re-admission can generate new client secrets. Diagnose projection with:

```bash
oc get password,externalsecret -n cf-idp-secrets
oc get clustersecretstore
oc get keycloakoidcclient -n cf-idp-keycloak
oc get externalsecret -A | grep -E 'apicurio-client|microcks-client'
```

Never copy Secret data into tickets. A build namespace must have both its Domain label and
`platform.contract-first.io/build-environment=true`; a non-build namespace receiving either local
publisher Secret is a security defect.

## Keycloak Operator and clients

The CF-IDP Keycloak Subscription uses automatic InstallPlan approval and starts from the current
known-good `keycloak-operator.v26.7.1`. The `fast` channel may advance; the operational contract is
support for declarative `KeycloakOIDCClient`, not permanent patch immutability. The CF-IDP operator,
Keycloak instance, realm imports, and clients live only in `cf-idp-keycloak`. Existing workshop
identity infrastructure is outside CF-IDP ownership.

CF-IDP guarantees only that its own OperatorGroup is namespace-scoped to `cf-idp-keycloak`; it does
not inspect or manage other Operators. The environmental coexistence requirement is that another
Keycloak Operator must not effectively watch `cf-idp-keycloak`, and shared CRD versions must remain
compatible. Before installing or changing a Keycloak Operator, compare effective scopes from CSV
`olm.targetNamespaces` annotations and runtime controller configuration. A manifest's requested
`OperatorGroup.spec.targetNamespaces` alone is insufficient. Shared Keycloak CRDs are cluster-scoped,
so confirm served/storage versions and recheck every pre-existing Keycloak operand after an operator
installation or upgrade.

`KeycloakOIDCClient` is an experimental upstream API in this release; its `keycloakCRName` and
`secretRef` are deliberately same-namespace references.

Useful non-secret, optional coexistence checks are:

```bash
oc get subscription,installplan,csv -n cf-idp-keycloak
oc get operatorgroup -n cf-idp-keycloak -o yaml
oc get csv -A \
  -o custom-columns='NAMESPACE:.metadata.namespace,NAME:.metadata.name,TARGETS:.metadata.annotations.olm\.targetNamespaces'
oc get keycloak,keycloakrealmimport,keycloakoidcclient -n cf-idp-keycloak
oc get crd keycloaks.k8s.keycloak.org \
  keycloakrealmimports.k8s.keycloak.org \
  keycloakoidcclients.k8s.keycloak.org
oc auth can-i create keycloakoidcclients.k8s.keycloak.org \
  --as system:serviceaccount:<build-namespace>:pipeline -n cf-idp-keycloak
```

The last result must be `no`.

## Quay bootstrap

On the first installation, the `quay-initialize` Job waits for Quay and creates the configured
initial user at sync wave 5. It remains a one-shot Job with no Kubernetes API access. At sync wave
6, the separate `quay-activate` Job restarts `deployment/registry-quay-app`, so Quay starts with a
valid `BOOTSTRAP_TOKEN_OWNER`. Quay then produces `registry-bootstrap-token`; the existing External
Secrets and Quay Bridge flow carries that token to the integration.

`quay-activate` uses its own namespace-local ServiceAccount. Its Role can only get and patch the
generated `registry-quay-app` Deployment. On an existing installation, the completed
`quay-initialize` Job remains untouched and only the new activation Job runs.
