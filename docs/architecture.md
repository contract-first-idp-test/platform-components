# Architecture

The root `catalog-info.yaml` is the public platform-target contract. Backstage, the golden paths,
ESO consumers, and the platform ApplicationSet all read the same schema under `spec.platform`.
All golden-path-managed repositories use `/catalog-info.yaml` as their primary catalog descriptor,
and one App-scoped GitHub catalog provider discovers that path throughout repositories visible to
the configured CF-IDP GitHub App installations.

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

The public target is materialized into `platform-target-config`. The Keycloak realm is `platform`;
`platform-maintainers` owns platform capabilities while `domain-maintainers` owns tenant entities.
Stable realm and client identifiers are kept directly in their consuming manifests. Credentials
remain local in ignored `bootstrap/secrets.env`, are copied to `platform-secrets`, and flow through
ESO to workload-local Secrets. Developer Hub and Dev Spaces are currently configured against one
CF-IDP GitHub App without merging their token semantics: Developer Hub receives the App ID, client
credentials, and ESO-decoded private key for installation-token automation; Dev Spaces receives
only the client credentials for per-user GitHub authorization. Human Developer Hub authentication
remains Keycloak, and the App private key never enters the Dev Spaces namespace. See the
[authoritative App setup](../bootstrap/README.md#create-the-cf-idp-github-app).

The in-cluster Kubernetes integration keeps authentication and TLS trust independent. It uses the
existing `backstage-cluster-viewer` token, connects to `https://kubernetes.default.svc`, and trusts
the namespace-maintained `kube-root-ca.crt` mounted through the RHDH `extraFiles` mechanism.

The public target also carries the two non-secret GitOps webhook endpoints. A deterministic Route
exposes only the ApplicationSet controller's `webhook` service port; the standard Argo CD server
Route supplies the Application webhook. Domain and System golden paths attach both push webhooks,
with polling retained as recovery.
