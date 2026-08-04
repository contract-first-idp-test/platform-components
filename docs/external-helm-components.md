# External Helm components

Microcks is the one external Helm exception in the platform ApplicationSet. Its named
`renderer: microcks` branch preserves chart repository `https://microcks.io/helm`, chart version
`1.14.0`, release name and namespace, portable values from `components/microcks/values.yaml`, and a
secondary platform-repository source for companion resources.

Workshop hostnames and Keycloak integration are inline values derived from the catalog router
domain. No target-owned Helm values file is generated or committed.
