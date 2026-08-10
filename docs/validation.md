# Validation

[Back to the repository overview](../README.md)

Run `make test` from the repository root. Its direct equivalent is `npm ci --prefix test` followed
by `npm test --prefix test`. All Node and Jest tooling is scoped under `test/`; the repository
itself is not an npm package. The suite checks shell syntax and the
simplified architecture, exercises
the workshop helper in a temporary repository with mocked cluster discovery, verifies the helper
does not edit the inventory, and renders the GitOps operator, GitOps instance, and repository-root
Kustomizations with normal load restrictions.

ApplicationSet expansion remains a live-controller verification because local validation does not
reimplement the OpenShift GitOps controller.

## Installation validation

These checks are optional after the workshop guide hands reconciliation to Argo CD. The generated
`catalog-info.yaml` remains the expected public state; compare live URLs with the descriptor rather
than deriving new expected values from cluster metadata.

Confirm that the ApplicationSet and its selected Applications exist, and that External Secrets are
converging:

```bash
oc get applicationsets.argoproj.io -n openshift-gitops
oc get applications.argoproj.io -n openshift-gitops
oc get externalsecrets.external-secrets.io -A
```

ApplicationSet expansion requires the live OpenShift GitOps controller, so it is intentionally not
part of local repository validation.

## GitHub App integrations

Developer Hub receives GitHub App installation credentials for platform automation. Confirm that
its ExternalSecret is ready, that the resulting Secret has the expected keys, and that the rollout
is available:

```bash
oc get externalsecret rhdh-secrets -n developer-hub
oc get secret rhdh-secrets -n developer-hub \
  -o go-template='{{range $key, $_ := .data}}{{printf "%s\\n" $key}}{{end}}'
oc rollout status deployment/backstage-backstage -n developer-hub --timeout=10m
```

The in-cluster integration also depends on the mounted Kubernetes CA:

```bash
oc exec deployment/backstage-backstage -n developer-hub -- \
  test -r /opt/app-root/src/kubernetes-ca/ca.crt
```

Sign in to Developer Hub through Keycloak using the configured demo-user credentials. Validate the
GitHub App path by confirming catalog discovery or running a golden path; GitHub is not the human
Developer Hub sign-in provider.

Dev Spaces receives only the GitHub App client credentials for per-user authorization. Confirm its
ExternalSecret and Secret, then inspect the live URL:

```bash
oc get externalsecret github-oauth-config -n openshift-devspaces
oc get secret github-oauth-config -n openshift-devspaces \
  -o go-template='{{range $key, $_ := .data}}{{printf "%s\\n" $key}}{{end}}'
oc get checluster devspaces -n openshift-devspaces \
  -o jsonpath='{.status.cheURL}{"\n"}'
```

Compare that URL with `spec.platform.services.devSpaces.url` in `catalog-info.yaml`; the registered
callback must match `spec.platform.services.devSpaces.githubCallbackUrl`. Start a workspace from an
App-visible repository and confirm clone, pull, and push authorization without a personal access
token or a separate GitHub OAuth App.
