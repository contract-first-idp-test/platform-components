# OpenShift Workshop Target

The authoritative public target contract and runtime configuration are consolidated in
`targets/workshop/catalog-info.yaml`, with Microcks render overrides in
`targets/workshop/helm/microcks.yaml`. Templates consume `spec.platform` directly from the fetched
target entity.

The checked-in workshop profile was derived from a Red Hat workshop cluster running OpenShift 4.21.25.

Validated capabilities included:

- healthy Red Hat, certified, and community Operator catalogs;
- default expandable ODF Ceph RBD storage;
- NooBaa ObjectBucketClaim provisioning;
- externally trusted OpenShift Routes;
- outbound GitHub, Quay, registry.redhat.io, Maven, and Open VSX access;
- existing Red Hat cert-manager 1.20 and RHBK 26.4 operators.

The profile expresses those existing operators declaratively: `profiles/workshop` simply omits the cert-manager and RHBK operator Applications.

It does not reuse the workshop `Keycloak/keycloak` instance or `sso` realm. It creates `Keycloak/cf-idp-keycloak` and an independent `cf-idp` realm in the same namespace, relying on the existing namespace-scoped RHBK operator.

Keycloak uses an OpenShift service-serving certificate behind a generated-host re-encrypt Route.
Quay keeps operator-managed object storage because the Quay Operator can consume the cluster's OBC
capability directly. Microcks is an external Helm component pinned to the official chart at 1.14.0,
not a community OLM operator.

The Developer Hub Secret derives `SCHEMA_REGISTRY_HOST` from the target Registry API URL. Its
backend reader allowlist admits only that host under `/apis/registry/v3/`. API publication clones
the Spectral rules named by `platform.spectralRules` and runs the installed
`spectral-quality-gate` before Apicurio publication.
