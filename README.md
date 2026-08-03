# Contract-First IDP Platform Components

A declarative GitOps distribution of the shared services used by the Contract-First IDP demo on OpenShift.

Version **1.0.0** is the immutable coordinated Contract-First IDP baseline. Profiles are ordinary
checked-in Kustomizations. Installation is a short sequence of `oc` commands; Argo CD owns
everything after the root Application is created.

`v1.0.0` pins compatibility and companion dependencies. `main` (or the branch configured by
`PLATFORM_CONFIG_REVISION`) is mutable installation configuration: Argo watches it and Domain
admission pull requests target it. A Git tag is never used as an admission branch.

## Profiles

- `profiles/workshop` — the default target. It assumes cert-manager and the RHBK operator already exist, but creates an independent `cf-idp-keycloak` instance and realm.
- `profiles/full` — a fresh-cluster profile that installs every selected operator and service, including optional Apicurito.
- `profiles/minimal` — GitOps projects, the External Secrets seam, and zero-tenant admission.

A profile selects capabilities by listing resources. To disable a capability, remove its operator and service Application from the profile. To adopt an existing operator, omit only its `operator-*` Application and keep the service Application.

## What the workshop profile provides

OpenShift GitOps, External Secrets Operator, Red Hat Developer Hub, Dev Spaces, OpenShift Pipelines, an independent Red Hat build of Keycloak instance, Crunchy PostgreSQL, Red Hat Quay and Quay Bridge, Red Hat build of Apicurio Registry, Microcks, and Red Hat Hawtio.

Kaoto Camel Designer is delivered through Dev Spaces/Open VSX and the companion software-template workspace recommendations. It is not modeled as an Operator.

## Configure

1. Fork this repository and the companion Contract-First IDP repositories into one GitHub organization.
2. Edit and commit the three public inputs to the branch referenced by
   `PLATFORM_CONFIG_REVISION`: `config/platform.env`, `targets/workshop/catalog-info.yaml`, and
   `targets/workshop/helm/microcks.yaml`.
3. Create the ignored secret file locally:

```bash
cp bootstrap/secrets.env.example bootstrap/secrets.env
```

Fill every required value. Generate random values explicitly, for example:

```bash
openssl rand -base64 32
```

Commit and push the non-secret repository configuration before bootstrap. Never commit `bootstrap/secrets.env`.

## Bootstrap the workshop profile

Log in as a cluster administrator, then run:

```bash
oc apply -k bootstrap/gitops/operator
```

Wait for the operator-created default Argo CD instance:

```bash
until oc get argocd/openshift-gitops -n openshift-gitops >/dev/null 2>&1; do sleep 5; done
oc wait --for=condition=Available deployment/openshift-gitops-server \
  -n openshift-gitops --timeout=10m
```

Apply the small GitOps RBAC addition and create the credential source Secret. This is the only
source Secret created manually; public configuration is generated from Git by the selected
profile.

```bash
oc apply -k bootstrap/gitops/instance
oc apply -f components/external-secrets/namespace.yaml
oc create secret generic platform-secrets \
  -n cf-idp-secrets \
  --from-env-file=bootstrap/secrets.env \
  --dry-run=client -o yaml | oc apply -f -
```

Create the root Application:

```bash
oc kustomize bootstrap/root --load-restrictor=LoadRestrictionsNone | oc apply -f -
```

For a fresh cluster, render `bootstrap/root/full` the same way. For the bootstrap-only profile,
render `bootstrap/root/minimal`. The unrestricted loader is required because these small overlays
intentionally read the authoritative root-level `config/platform.env` rather than duplicating it.

From that point forward, Argo CD reconciles the selected operator and service Applications from Git.

## Observe

```bash
oc get applications.argoproj.io -n openshift-gitops
oc get subscriptions.operators.coreos.com,clusterserviceversions.operators.coreos.com -A
oc get externalsecrets.external-secrets.io -A
```

## Configuration and credential abstraction

Argo creates `platform-bootstrap-config` and `platform-target-config` from checked-in files. The
installer creates only `platform-secrets` from the ignored credential file. Separate
`cf-idp-config` and `cf-idp-secrets` stores materialize stable namespace-local workload Secrets.
Production deployments can replace the credential store with Vault, Conjur, AWS Secrets Manager,
Azure Key Vault, or another approved backend without changing workload Secret names.

See `docs/external-secrets-architectural-seam.md`.

## Validation

Contributor-side validation remains available:

```bash
make validate
```

It parses YAML, checks pinned product contracts and ExternalSecret source keys, rejects obsolete APIs and installer-framework remnants, and renders every local Kustomization structurally. It does not mutate configuration or install anything.

## Repository layout

- `bootstrap/` — GitOps bootstrap resources and the local secret-file boundary
- `config/` — checked-in cluster and repository values
- `profiles/` — explicit `workshop`, `full`, and `minimal` Application graphs
- `argocd/operator-applications/` — one Application per operator
- `argocd/applications/` — one Application per platform service
- `components/` — operator operands and shared platform resources
- `targets/` — public target metadata and trusted Domain runtime values
- `tenants/` — append-only per-Domain admission directories; empty is valid
- `operators/` — pinned OLM Subscriptions (Microcks is intentionally not here)
- `scripts/` — contributor-side validation only

Gitea is available at `components/gitea`, with its unselected Application at
`argocd/applications/gitea.yaml`. A user-created profile can include that Application; no supplied
profile selects it.
