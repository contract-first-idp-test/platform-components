# Validation

Run `make test` from the repository root. Its direct equivalent is `npm ci --prefix test` followed
by `npm test --prefix test`. All Node and Jest tooling is scoped under `test/`; the repository
itself is not an npm package. The suite checks shell syntax and the
simplified architecture, exercises
the workshop helper in a temporary repository with mocked cluster discovery, verifies the helper
does not edit the inventory, and renders the GitOps operator, GitOps instance, and root
Kustomizations with the unrestricted loader.

ApplicationSet expansion remains a live-controller verification because local validation does not
reimplement the OpenShift GitOps controller.
