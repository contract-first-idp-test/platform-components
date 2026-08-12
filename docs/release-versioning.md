# Release and compatibility model

Each Contract-First IDP repository versions the contract it owns:

```text
software-templates -> developer-charts -> platform-components
software-templates ----------------------> platform-components
```

- `platform-components` owns the PlatformTarget and shared platform behavior.
- `developer-charts` owns tenant runtime/chart values and rendered-resource contracts.
- `software-templates` owns golden paths and generated repository structures.

Repository versions are independent. A patch repairs implementation without changing dependency
requirements. A minor may add capability and raise a dependency floor. A major denotes an
incompatible change to that repository's own contract and may require migration.

Compatibility ranges and selected revisions answer different questions. For example,
`developer-charts >=1.0.0 <1.1.0` states what a template release can consume, while `v1.0.1` is the
immutable tag actually selected by a PlatformTarget and written into generated Argo CD state.
Branches and wildcard release refs are not supported installation coordinates.

The root `release.yaml` contains this repository's version. The configured PlatformTarget exposes:

```yaml
spec:
  platform:
    distribution:
      version: 1.1.0
      revision: v1.1.0
    dependencies:
      developerCharts:
        revision: v1.0.1
        version: 1.0.1
      softwareTemplates:
        revision: v1.1.0
        version: 1.1.0
```

`softwareTemplates` is a publication/discovery coordinate: Developer Hub reads that exact catalog
release. It is not a compatibility dependency of platform-components. `developerCharts` is the
exact runtime implementation coordinate selected by the platform target. The legacy `charts`
alias remains equal to it for the v1 chart values contract.

An independent patch sequence can therefore be:

```text
platform-components 1.1.3
developer-charts    1.0.4
software-templates  1.1.2
```

`software-templates 1.1.3` may retain exactly the same requirements and needs no chart or platform
retag. Likewise, `developer-charts 1.0.5` remains accepted by a template range covering `1.0.x`;
the installation stays on its prior exact tag until an operator intentionally changes it.

An additive evolution may instead publish platform-components 1.2.0, developer-charts 1.1.0 with
`platformComponents: ">=1.2.0 <2.0.0"`, and software-templates 1.2.0 with corresponding raised
floors. Tests encode both patch invariance and this permitted minor evolution.
