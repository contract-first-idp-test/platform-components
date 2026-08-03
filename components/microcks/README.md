# Microcks

Argo CD installs the official Microcks `microcks` chart from `https://microcks.io/helm`, pinned to
`1.14.0`. This directory is the Git source in its multi-source Application: `values.yaml` contains
portable, nonconfidential defaults, while the kustomization renders the Namespace and the
ESO-managed `microcks-mongodb-connection` companion Secret.

Workshop render-time endpoints are in `targets/workshop/helm/microcks.yaml`. External Keycloak is
enabled, bundled Keycloak and async support are disabled, and no Keycloak client credential is
passed to the synchronous Microcks workload. The same service-account credential remains owned by
the Keycloak realm and is distributed to the pipeline integration through ESO.

The chart's bundled MongoDB workload requires the Secret name `microcks-mongodb-connection` and the
keys `username`, `password`, `adminUsername`, and `adminPassword`; `bootstrap/secrets.env` supplies
those credentials. OpenShift's Ingress-to-Route controller supplies edge termination, so chart-side
self-signed certificate generation is disabled.

Contributor render check:

```bash
helm template microcks microcks/microcks --version 1.14.0 --namespace microcks \
  --values components/microcks/values.yaml \
  --values targets/workshop/helm/microcks.yaml \
  --api-versions route.openshift.io/v1/Route
```
