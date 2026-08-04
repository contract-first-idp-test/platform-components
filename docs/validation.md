# Validation

Run `npm ci` followed by `npm test`. The Jest suite under `test/` checks shell syntax and the
simplified architecture, exercises
the workshop helper in a temporary repository with mocked cluster discovery, verifies the helper
does not edit the inventory, and renders the GitOps operator, GitOps instance, and root
Kustomizations with the unrestricted loader.

ApplicationSet expansion remains a live-controller verification because local validation does not
reimplement the OpenShift GitOps controller.
