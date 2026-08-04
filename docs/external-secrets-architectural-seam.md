# External Secrets as the configuration seam

The activated workshop has two source Secrets in `cf-idp-secrets`:

- `platform-target-config`, generated from root `catalog-info.yaml` as `platform.yaml`;
- `platform-secrets`, created manually from ignored `bootstrap/secrets.env`.

Argo CD owns the two public sources. Credentials remain outside Git. Separate
`ClusterSecretStore/cf-idp-config` and `ClusterSecretStore/cf-idp-secrets` contracts let
namespace-local ExternalSecrets combine public target facts and credentials while workloads depend
only on stable local Secret names.

Apicurio, Quay Bridge, and Microcks require public render-time scalar values. The ApplicationSet
derives those from the router domain; it never places credentials in inline patches or Helm values.
