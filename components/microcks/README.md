# Microcks

This Kustomize component owns the Microcks namespace, workloads, services, MongoDB storage,
platform Route, and ESO-provided MongoDB Secret.

The manifests are separated by resource responsibility:

- `config.yaml` and `mongodb-init-config.yaml` contain application configuration;
- `deployment.yaml`, `postman-deployment.yaml`, and `mongodb-deployment.yaml` contain workloads;
- the service files expose those workloads; and
- `mongodb-pvc.yaml` declares persistent storage.

Local Kustomize replacements derive the Route, public URL, and Keycloak endpoints from the generic
router-domain annotation supplied by the platform ApplicationSet.
