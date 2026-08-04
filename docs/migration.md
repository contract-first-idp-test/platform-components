# Configuration migration

The workshop installation now has one root catalog entity, one ApplicationSet inventory, and one
ignored credential file. Generated target bundles, target-owned overlays, generated Helm values,
and duplicate handwritten Application inventories have been removed.

Existing installations should treat this as a direct configuration migration. Generate and commit
the root catalog, review the ApplicationSet selection, configure the existing OpenShift GitOps
instance, create `platform-secrets`, and apply `bootstrap/root`. Removing an existing selection is
not an uninstall operation.
