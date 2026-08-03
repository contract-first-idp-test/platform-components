# Platform targets

Each directory contains one authoritative Backstage `Resource` entity used by platform consumers,
Scaffolder templates, and the Domain chart. A target identifies one platform repository attachment
point. Environment-level target placement remains a future contract.

The `Resource` contract uses these named `spec` fields:

| Field | Consumer |
| --- | --- |
| `platform.target.name` | Human-readable target identity |
| `platform.distribution.version` | Immutable coordinated compatibility baseline |
| `platform.configuration.*` | Platform admission repository, mutable revision, and self-referential values path |
| `platform.tenantAdmission.*` | Mutable PR branch and append-only admission root |
| `platform.dependencies.*` | Immutable software-template and developer-chart coordinates |
| `platform.{cluster,argocd,schemaRegistry,spectralRules,registry,services,build}` | Trusted runtime, quality, and delivery configuration |

`spec.platform.configuration.valuesPath` points back to the entity itself. Templates consume the
already-fetched catalog entity directly, while Argo CD stores the same file as `platform.yaml` for
ExternalSecret consumers.

`platform.spectralRules` supplies the repository, immutable revision, and ruleset path used by API
publication Pipelines. RHDH derives its narrowly scoped Registry read host from
`platform.schemaRegistry.apiUrl`; neither value has a separate manual hostname or repository
override.
