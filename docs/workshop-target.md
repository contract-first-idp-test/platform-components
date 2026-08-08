# Workshop target

The authoritative public target contract is root `catalog-info.yaml`. Run
`bootstrap/configure-workshop.sh` after logging into OpenShift to render it from the readable
bootstrap template and to configure the fork URL and branch used during bootstrap.

The current golden-path contract remains under `spec.platform`, including repository, tenant
admission, cluster, dependency, schema-registry, registry, service, and build facts. Its
`valuesPath` is `catalog-info.yaml` so Domain activation reads the root entity from the platform
repository.

`spec.platform.argocd.webhooks.application` and `applicationSet` are public, non-secret endpoints
derived from the discovered router domain. Domain and System golden paths use them for immediate
push notification while their Git generators continue polling.
