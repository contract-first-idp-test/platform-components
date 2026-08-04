# Microcks companion resources

This Kustomize base owns the namespace and ESO-provided MongoDB Secret consumed by the official
Microcks chart. Portable chart defaults remain in `values.yaml`.

The `microcks` branch in `bootstrap/root/platform-applicationset.yaml` owns the chart source and
derives workshop routes and Keycloak endpoints from root `catalog-info.yaml`. There is no generated
target values file.
