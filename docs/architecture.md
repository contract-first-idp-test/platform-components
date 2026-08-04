# Architecture

The root `catalog-info.yaml` is the public platform-target contract. Backstage, the golden paths,
ESO consumers, and the platform ApplicationSet all read the same schema under `spec.platform`.
All golden-path-managed repositories use `/catalog-info.yaml` as their primary catalog descriptor,
and one GitHub catalog provider discovers that path throughout the configured organization.

`bootstrap/root/platform-applicationset.yaml` is the operational inventory. Its matrix combines the
root catalog file with a compact static Application list. The shared template supplies the target
repository, revision, destination, synchronization, and retry behavior. Explicit template-patch
branches provide inline Apicurio ingress hosts, the Quay Bridge hostname, and Microcks Helm values.
The controller accepts the per-ApplicationSet `create-update` policy. Generated Applications have
no resource-deletion finalizer, and inventory removal remains separate from explicit uninstall.
Retries and self-healing drive all-at-once convergence; the inventory does not claim staged order.

`bootstrap/root/kustomization.yaml` contains the two bootstrap coordinates needed before the
ApplicationSet can read the catalog. Kustomize injects them into the root Application, the Git file
generator, and AppProject source allowlists. The configuration helper changes only those literals
and the root catalog entity.

The public target is materialized into `platform-target-config`. Stable Keycloak realm and client
identifiers are kept directly in their consuming manifests. Credentials remain local in ignored
`bootstrap/secrets.env`, are copied
to `platform-secrets`, and flow through ESO to workload-local Secrets.
