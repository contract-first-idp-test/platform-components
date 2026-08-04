# Tenant admissions

This directory is intentionally valid with no tenant manifests. Domain creation pull requests add
one independent `tenants/<domain>/project.yaml` and `tenants/<domain>/application.yaml` pair.
The platform ApplicationSet consumes this directory recursively, so no parent kustomization or
per-Domain inventory edit is required.
