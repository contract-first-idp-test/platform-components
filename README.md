# Contract-First IDP Platform Components

A workshop-oriented GitOps distribution of the shared services used by the Contract-First IDP on
OpenShift.

The supported installation has three focused configuration surfaces:

- `catalog-info.yaml` — generated and committed public platform-target contract;
- `bootstrap/root/platform-applicationset.yaml` — committed operator and component selection;
- `bootstrap/secrets.env` — ignored local credential values.

See [bootstrap/README.md](bootstrap/README.md) for the complete workshop installation sequence.

Every repository managed by the Contract-First IDP golden paths stores its primary entity
descriptor at `/catalog-info.yaml`. Developer Hub discovers those root descriptors through one
GitHub catalog provider rule for the configured organization. Golden paths also immediately
register their generated root descriptor for prompt task feedback and repositories outside that
provider scope.

Reusable implementation charts are consumed from the coordinated
`charts/<entity>/<responsibility>` convention in `developer-charts`.

All Node and Jest tooling is scoped under `test/`; this repository is not an npm package. Run the
repository-local deterministic suite with:

```bash
make test
```

The direct equivalent is:

```bash
npm ci --prefix test
npm test --prefix test
```

`make check` remains a convenience alias for `make test`. Node and Jest are contributor and CI
tools only; workshop installation does not require them.

Installers normally fork only this repository and consume released dependencies. The three-sibling
workspace is only for contributors performing coordinated current-source compatibility checks.
