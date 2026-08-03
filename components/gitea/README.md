# Gitea component

Gitea is a normal platform component that is intentionally absent from every supplied profile.
Select its Argo CD Application from a user-created profile or overlay by adding this resource:

```yaml
resources:
  - ../../argocd/applications/gitea.yaml
```

Then render or apply that profile normally:

```bash
oc apply -k profiles/my-profile
```

This installs the SCM service only. To make Gitea the Developer Hub provider, add the maintained
Gitea and GitHub-compatibility dynamic plugins and switch the matching software-template branch.
Those plugin packages are not embedded because their package location and integrity are release
artifacts rather than cluster configuration.
