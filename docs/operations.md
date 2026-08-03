# Operations

## Observe reconciliation

```bash
oc get applications.argoproj.io -n openshift-gitops
oc get subscriptions.operators.coreos.com,clusterserviceversions.operators.coreos.com -A
oc get externalsecrets.external-secrets.io -A
```

Each selected operator has its own `operator-*` Argo CD Application. A failure in an optional community operator is isolated from unrelated platform capabilities.

## Change configuration or credentials

Public changes are normal GitOps changes. Edit `config/platform.env`,
`targets/workshop/catalog-info.yaml`, or `targets/workshop/helm/microcks.yaml`, commit them to the
configured mutable branch, and let Argo CD reconcile the generated source Secrets and workloads.

For credential changes only, edit the ignored `bootstrap/secrets.env`, then update the one manual
source Secret:

```bash
oc create secret generic platform-secrets \
  -n cf-idp-secrets \
  --from-env-file=bootstrap/secrets.env \
  --dry-run=client -o yaml | oc apply -f -
```

External Secrets refreshes namespace-local target Secrets.

## From-scratch workshop acceptance

1. In the platform fork, edit the three public configuration files above and the local
   `bootstrap/secrets.env`. Keep `PLATFORM_CONFIG_REVISION` on a branch such as `main`; keep the
   dependency baseline at `v1.0.0`.
2. Install OpenShift GitOps with `bootstrap/gitops/operator`, wait for its default instance, and
   apply `bootstrap/gitops/instance`. No custom health checks are required.
3. Create `cf-idp-secrets/platform-secrets` from `bootstrap/secrets.env` only.
4. Apply `bootstrap/root` (or a profile overlay). The root watches the mutable configuration branch.
5. Observe operator Applications and operand Applications. Their creation order is approximate;
   Argo CD retries while CRDs and operators become available.
6. Confirm Argo owns `platform-bootstrap-config` and `platform-target-config`, and ESO reports both
   `cf-idp-config` and `cf-idp-secrets` Ready.
7. Allow PostgreSQL, Keycloak, Quay, and Apicurio to converge.
8. Confirm Microcks is rendered from the official `microcks` chart at `1.14.0`, the two Git values
   files, and its ESO-managed MongoDB Secret—without an OLM operator or apply Job.
9. Confirm Pipelines, Dev Spaces, and Developer Hub converge. In Developer Hub's scaffolder action
   list, verify `roadiehq:utils:fs:parse`, `roadiehq:utils:fs:write`,
   `roadiehq:utils:jsonata`, and `roadiehq:utils:serialize:yaml`.
10. Register the workshop target and create Domain, System, API, and Component resources. The Domain
    admission PR must target the configured branch and add only its two `tenants/<domain>` files.
11. Verify API publication reaches Apicurio, the Component build reaches Quay, desired state enters
    the System repository, and Argo deploys the workload.

## Change the selected platform

Edit the active checked-in profile and push the change. Removing a service Application disables that service. Removing only an operator Application means the profile expects that operator to be supplied by the cluster.

## Quay initialization

The `quay` Application runs an idempotent sync hook. On a clean deployment it initializes the
administrator and stores the returned token for Quay Bridge. Quay Bridge remains a separate
Application. The operator-managed Route for `QuayRegistry/registry` in namespace `quay` is
`registry-quay-quay.<router-domain>`; keep the target Quay host and `QUAY_INTEGRATION_URL` aligned
with it.

## Realm imports

`KeycloakRealmImport` is a bootstrap mechanism, not a general realm-update controller. Review realm changes carefully. The independent `cf-idp` realm and database can be reset without touching the workshop's existing `Keycloak/keycloak` instance or `sso` realm.

## Teardown

Teardown is deliberately documented rather than hidden in a script. Review the selected profile first, because deleting `platform-root` cascades through child Applications and can delete namespaces and persistent data managed by those Applications.

At minimum, back up required data and inspect:

```bash
oc get applications.argoproj.io -n openshift-gitops
oc get pvc -A
```

Then remove specific service Applications or the root Application intentionally. Operators omitted from the active profile are not owned by this repository.
