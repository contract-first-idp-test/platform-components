# Tenant admissions

This directory is intentionally valid with no tenant manifests. Domain creation pull requests add
one independent `tenants/<domain>/project.yaml` plus a non-Kubernetes `admission.yaml` descriptor;
the platform-owned `tenant-domain-applications` ApplicationSet combines each descriptor with the current
mutable PlatformTarget. Existing Domain Applications therefore converge whenever the installation
selects another compatible exact developer-charts tag, without recreating the Domain.
