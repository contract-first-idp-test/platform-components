# Architecture

## Bootstrap boundary

The bootstrap is intentionally declarative and narrow:

1. apply the pinned OpenShift GitOps Subscription;
2. wait for the operator-created `openshift-gitops` Argo CD instance;
3. create only the credential source Secret `platform-secrets` from the ignored `bootstrap/secrets.env`;
4. apply a profile-specific root Application.

No script discovers cluster state, rewrites configuration, generates a profile, or hides credentials. Everything after the root Application is reconciled by Argo CD.

## Application graph

`platform-root` points directly at one checked-in profile:

- `profiles/workshop`
- `profiles/full`
- `profiles/minimal`

Each profile contains:

- AppProjects first (`sync-wave: -30`);
- independent operator Applications (`-20`);
- External Secrets infrastructure (`-15`);
- selected shared services in dependency order;
- generic recursive tenant admission last; the platform remains valid with zero Domains.

Each admitted Domain has an independent directory under `tenants/`. Its parent Application combines
tenant lifecycle policy, target-owned runtime values, and the trusted developer charts. No shared
tenant allowlist or generated tenant index exists.

## Adoption by omission

There is no runtime `adopt` state. A profile adopts an operator simply by omitting that operator's Subscription Application while retaining the operand Application.

The workshop profile therefore omits:

- `operator-cert-manager`, while using the cluster's existing cert-manager installation;
- `operator-keycloak`, while creating a separate `Keycloak/cf-idp-keycloak`, database, Route, and `cf-idp` realm.

## Secret flow

```text
config/platform.env --------> platform-bootstrap-config --\
target catalog-info.yaml --> platform-target-config ------+--> cf-idp-config ----\
bootstrap/secrets.env ------> platform-secrets -----------> cf-idp-secrets -----+--> component-local Secrets
```

The first two Secrets are generated and continuously reconciled by Argo CD. Only the credential
Secret is created outside Git. ExternalSecrets use per-item store references and engine v2 when a
consumer needs both sources; templates parse `platform.yaml` and emit only required local keys.

The source can later move to an enterprise secret manager while workload-facing Secret contracts remain stable.

## Direct scalar exceptions

The target runtime YAML is authoritative. Three duplicated bootstrap scalars remain because the
operator APIs require render-time scalar fields and cannot read a Secret:

| Bootstrap key | Consumer field | Why retained |
|---|---|---|
| `APICURIO_APP_HOST` | `ApicurioRegistry3.spec.app.ingress.host` | The 3.2 operator requires a host when it manages ingress and does not generate this value. |
| `APICURIO_UI_HOST` | `ApicurioRegistry3.spec.ui.ingress.host` | Same operator constraint for the UI ingress. The redundant UI API environment variable is omitted. |
| `QUAY_INTEGRATION_URL` | `QuayIntegration.spec.quayHostname` | The CRD requires a URL scalar and supports neither Secret reference nor generated default. |

Validation compares these values with `platform.schemaRegistry` and `platform.registry.quay` so the
narrow duplication cannot silently drift. Keycloak and Gitea omit explicit Route hosts and use
OpenShift-generated names. Microcks endpoints are honest Helm render-time values in the target file.

## Product-specific choices

- Keycloak uses a service-serving certificate and re-encrypt Route.
- Quay uses `QuayRegistry/registry` in namespace `quay`. Route and TLS remain operator managed, so
  its external hostname follows the operator/OpenShift convention
  `registry-quay-quay.<router-domain>` and changes if either resource name or namespace changes.
- Quay keeps operator-managed object storage so ODF/NooBaa OBC discovery remains automatic.
- Microcks uses the official upstream chart `microcks` 1.14.0 and the independent Keycloak realm.
- Kaoto is a Dev Spaces extension recommendation, not an Operator.
- Apicurito is included only in the full profile.
