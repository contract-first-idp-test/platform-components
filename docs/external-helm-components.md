# External Helm Components

Use OLM when a supported operator owns lifecycle and upgrades. Use local Kustomize for resources the
platform owns directly. Use an external Helm component when no suitable OLM offering exists and an
upstream project maintains a chart.

An external Helm component has `components/<name>` for portable values and optional companion
resources, one normal `argocd/applications/<name>.yaml`, and target overrides under
`targets/<target>/helm`. Its AppProject explicitly admits the chart repository. The Application uses
multiple sources: an exactly pinned remote chart and the mutable platform Git source with a `ref`.
`$values` loads portable values first and target values second. Profiles select this ordinary service
Application; there is no platform-wide Helm installer.

Pin chart name, repository, and release version exactly. Review chart provenance, release notes,
templates, CRDs, security contexts, and value changes before upgrading. Upstream charts are not
vendored because the immutable remote artifact is the reviewed supply-chain boundary; local copies
would obscure provenance and drift from upstream. If a chart needs companion Namespaces or
ExternalSecrets, give the Git values source a `path` so Argo renders them too.

Render-time endpoints belong in Git values. Credentials never belong in values or Argo parameters.
Use ESO only when the chart or rendered workload supports an existing Secret, `secretKeyRef`, or a
mounted Secret.

Microcks is the reference implementation: `https://microcks.io/helm`, chart `microcks`, version
`1.14.0`. `components/microcks/values.yaml` is portable;
`targets/workshop/helm/microcks.yaml` supplies workshop endpoints; and the component ExternalSecret
creates the MongoDB Secret consumed by the chart.
