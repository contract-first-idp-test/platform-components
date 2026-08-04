# Manifest provenance

This repository deliberately evolves rather than discards the prior implementations.

- Argo CD project separation, ApplicationSet composition, operator composition, Keycloak 26,
  `ApicurioRegistry3`, Quay Bridge, Crunchy PostgreSQL, RHDH 1.10 configuration, and the Java 21
  Maven Task originate in the referenced Nusun platform manifest.
- Apicurito, Kaoto, Hawtio, Microcks, Dev Spaces, Spectral, demo users, and the original app-of-apps
  installation experience are retained from the existing Contract-First IDP platform manifest.
- The current developer-chart requirements define the Domain-to-System, Tekton resolver, Maven,
  Apicurio 3, Quay Bridge, and PostgreSQL contracts checked by this repository.
- Helm was removed from the platform composition layer. Product operators and custom resources are
  expressed as Kustomize packages and independently reconciled Argo CD Applications.
