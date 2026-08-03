# Validation

Run:

```bash
make validate
```

The validation suite performs:

- YAML parsing;
- pinned Operator package, channel, and catalog assertions;
- nontrivial product CR API assertions;
- source-key coverage for every `ExternalSecret`;
- rejection of obsolete Kaoto and Microcks APIs, unsafe demo defaults, and removed installer-framework references;
- contract checks for the `full`, `workshop`, and `minimal` profiles;
- structural rendering of every local Kustomization.

Validation is contributor tooling only. It does not discover the cluster, mutate configuration, create credentials, or perform installation.

Static rendering cannot prove OLM resolution, CRD admission, image pulls, storage provisioning, Routes, or controller convergence. A live installation remains the final integration test.
