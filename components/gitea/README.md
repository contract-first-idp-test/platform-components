# Optional Gitea component

Gitea is reusable but is not selected by the default workshop inventory. To install it before
initial activation, add one ordinary Kustomize entry for `components/gitea` to
`bootstrap/root/platform-applicationset.yaml` and review the reserved Gitea values in
`bootstrap/secrets.env`.
