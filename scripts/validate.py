#!/usr/bin/env python3
from pathlib import Path
import re
import sys
import yaml

R = Path(__file__).resolve().parents[1]
errors: list[str] = []

def fail(message: str) -> None:
    errors.append(message)

# Parse every YAML document.
for path in sorted([*R.rglob("*.yaml"), *R.rglob("*.yml")]):
    if ".git" in path.parts:
        continue
    try:
        list(yaml.safe_load_all(path.read_text()))
    except Exception as exc:
        fail(f"{path.relative_to(R)}: invalid YAML: {exc}")

# Operator contracts observed on the workshop catalog.
expected = {
    "bootstrap/gitops/operator/subscription.yaml": ("openshift-gitops-operator", "gitops-1.21", "redhat-operators"),
    "operators/external-secrets/subscription.yaml": ("openshift-external-secrets-operator", "stable-v1", "redhat-operators"),
    "operators/developer-hub/subscription.yaml": ("rhdh", "fast", "redhat-operators"),
    "operators/devspaces/subscription.yaml": ("devspaces", "stable", "redhat-operators"),
    "operators/openshift-pipelines/subscription.yaml": ("openshift-pipelines-operator-rh", "pipelines-1.23", "redhat-operators"),
    "operators/apicurio-registry/subscription.yaml": ("apicurio-registry-3", "3.2.x", "redhat-operators"),
    "operators/quay/subscription.yaml": ("quay-operator", "stable-3.18", "redhat-operators"),
    "operators/quay-bridge/subscription.yaml": ("quay-bridge-operator", "stable-3.18", "redhat-operators"),
    "operators/keycloak/subscription.yaml": ("rhbk-operator", "stable-v26.4", "redhat-operators"),
    "operators/hawtio/subscription.yaml": ("red-hat-hawtio-operator", "v2", "redhat-operators"),
    "operators/apicurito/subscription.yaml": ("apicurito", "1.0.x", "community-operators"),
}
for rel, contract in expected.items():
    document = yaml.safe_load((R / rel).read_text())
    spec = document.get("spec", {})
    actual = (spec.get("name"), spec.get("channel"), spec.get("source"))
    if actual != contract:
        fail(f"{rel}: expected package/channel/source {contract}, got {actual}")

cr_contracts = {
    "components/keycloak/keycloak.yaml": ("k8s.keycloak.org/v2alpha1", "Keycloak"),
    "components/keycloak/realm.yaml": ("k8s.keycloak.org/v2alpha1", "KeycloakRealmImport"),
    "components/apicurio/apicurio-registry.yaml": ("registry.apicur.io/v1", "ApicurioRegistry3"),
    "components/hawtio/hawtio.yaml": ("hawt.io/v2", "Hawtio"),
    "components/quay/quay.yaml": ("quay.redhat.com/v1", "QuayRegistry"),
}
for rel, contract in cr_contracts.items():
    document = next(doc for doc in yaml.safe_load_all((R / rel).read_text()) if doc)
    actual = (document.get("apiVersion"), document.get("kind"))
    if actual != contract:
        fail(f"{rel}: expected {contract}, got {actual}")

# Removed runtime machinery and obsolete contracts must not return.
text = "\n".join(
    path.read_text(errors="ignore")
    for path in R.rglob("*")
    if path.is_file()
    and ".git" not in path.parts
    and "__pycache__" not in path.parts
    and path.suffix != ".pyc"
    and path.name not in {"MANIFEST.sha256", "validate.py"}
)
for forbidden in [
    "demo" + "-domain",
    "DEMO_" + "DOMAIN_REPO_URL",
    "DEMO_" + "DOMAIN_REVISION",
    "designer.kaoto.io",
    "kaoto-operator",
    "microcks.io/v1alpha1",
    "kind: Microcks\n",
    "MCP_TOKEN",
    "SCAFFOLDER_DRY_RUN_TOKEN",
    "letmein",
    "stable-3.14",
    "channel: latest",
]:
    if forbidden in text:
        fail(f"forbidden obsolete, unsafe, or imperative value remains: {forbidden}")

for removed in [
    "optional",
    "profiles/generated",
    "components/registry",
    "components/schemas",
    "argocd/applications/registry.yaml",
    "argocd/applications/schemas.yaml",
    "targets/workshop/domain-values.yaml",
    "config/profile.env",
    "scripts/configure.sh",
    "scripts/bootstrap.sh",
    "scripts/generate-profile.py",
    "scripts/status.sh",
    "scripts/uninstall.sh",
]:
    if (R / removed).exists():
        fail(f"removed runtime installer artifact still exists: {removed}")

if "SETUP_COMPLETE: true" not in (R / "components/quay/external-secret.yaml").read_text():
    fail("Quay config must set SETUP_COMPLETE: true")
if "redhat.vscode-kaoto" not in (R / "docs/kaoto-devspaces.md").read_text():
    fail("Kaoto Dev Spaces contract is undocumented")

# The Resource entity is the one authoritative platform target document.
target_path = R / "targets/workshop/catalog-info.yaml"
target_catalog = yaml.safe_load(target_path.read_text())
target_spec = target_catalog.get("spec", {})
target_values = target_spec.get("platform", {})
if target_catalog.get("kind") != "Resource":
    fail("workshop target must be a Backstage Resource")
if target_spec.get("type") != "contract-first-idp-target":
    fail("workshop target must use spec.type contract-first-idp-target")
if not target_values:
    fail("workshop target must contain spec.platform")
for forbidden in ["targetName", "platformRepository", "dependencies"]:
    if forbidden in target_spec:
        fail(f"workshop target must not retain parallel field spec.{forbidden}")

def nested_value(document: dict, path: str):
    current = document
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            fail(f"workshop target is missing spec.platform.{path}")
            return None
        current = current[part]
    return current

for required_path in [
    "distribution.version",
    "configuration.host",
    "configuration.organization",
    "configuration.repository",
    "configuration.repositoryUrl",
    "configuration.revision",
    "configuration.valuesPath",
    "tenantAdmission.branch",
    "tenantAdmission.path",
    "target.name",
    "cluster.apiUrl",
    "cluster.routerDomain",
    "argocd.namespace",
    "argocd.destinationServer",
    "dependencies.softwareTemplates.repositoryUrl",
    "dependencies.softwareTemplates.revision",
    "dependencies.developerCharts.repositoryUrl",
    "dependencies.developerCharts.revision",
    "charts.repositoryUrl",
    "charts.revision",
    "schemaRegistry.apiUrl",
    "spectralRules.repositoryUrl",
    "spectralRules.revision",
    "spectralRules.path",
    "registry.quay.host",
    "build.sourceRevision",
]:
    nested_value(target_values, required_path)

if target_values.get("configuration", {}).get("valuesPath") != "targets/workshop/catalog-info.yaml":
    fail("spec.platform.configuration.valuesPath must point to the target entity itself")
if target_values.get("configuration", {}).get("revision") != "main":
    fail("workshop target configuration revision must be main")
if not re.fullmatch(r"[0-9a-f]{40}", target_values.get("spectralRules", {}).get("revision", "")):
    fail("workshop Spectral rules revision must be an exact Git commit")
if target_values["distribution"].get("version") != "v1.0.0":
    fail("workshop target dependency distribution must be v1.0.0")
platform_env_values = {
    line.split("=", 1)[0]: line.split("=", 1)[1]
    for line in (R / "config/platform.env").read_text().splitlines()
    if "=" in line and not line.lstrip().startswith("#")
}
for env_key, catalog_value in {
    "PLATFORM_REPO_URL": target_values["configuration"]["repositoryUrl"],
    "PLATFORM_CONFIG_REVISION": target_values["configuration"]["revision"],
    "SOFTWARE_TEMPLATES_REPO_URL": target_values["dependencies"]["softwareTemplates"]["repositoryUrl"],
    "SOFTWARE_TEMPLATES_REVISION": target_values["dependencies"]["softwareTemplates"]["revision"],
    "DEVELOPER_CHARTS_REPO_URL": target_values["dependencies"]["developerCharts"]["repositoryUrl"],
    "DEVELOPER_CHARTS_REVISION": target_values["dependencies"]["developerCharts"]["revision"],
    "SPECTRAL_RULES_REPO_URL": target_values["spectralRules"]["repositoryUrl"],
}.items():
    if platform_env_values.get(env_key) != catalog_value:
        fail(f"bootstrap {env_key} drifted from the workshop target pointer")
for env_key, target_value in {
    "APICURIO_APP_HOST": target_values["schemaRegistry"]["apiUrl"].split("/", 3)[2],
    "APICURIO_UI_HOST": target_values["schemaRegistry"]["uiUrl"].split("/", 3)[2],
    "QUAY_INTEGRATION_URL": target_values["registry"]["quay"]["url"],
}.items():
    if platform_env_values.get(env_key) != target_value:
        fail(f"documented direct scalar exception {env_key} drifted from target runtime values")

# Service names, namespaces, and the Quay operator-managed Route form one contract.
service_contracts = {
    "quay": ("components/quay", "quay"),
    "apicurio": ("components/apicurio", "apicurio"),
}
for application_name, (component_path, namespace) in service_contracts.items():
    application = yaml.safe_load((R / f"argocd/applications/{application_name}.yaml").read_text())
    if application["metadata"]["name"] != application_name:
        fail(f"{application_name} Application name drifted")
    if application["spec"]["source"]["path"] != component_path:
        fail(f"{application_name} Application path must be {component_path}")
    if application["spec"]["destination"]["namespace"] != namespace:
        fail(f"{application_name} Application namespace must be {namespace}")
    namespace_document = yaml.safe_load((R / component_path / "namespace.yaml").read_text())
    if namespace_document["metadata"]["name"] != namespace:
        fail(f"{component_path} must declare namespace {namespace}")

quay_registry = yaml.safe_load((R / "components/quay/quay.yaml").read_text())
if quay_registry["metadata"] != {
    "name": "registry",
    "namespace": "quay",
    "annotations": {"argocd.argoproj.io/sync-wave": "0"},
}:
    fail("QuayRegistry must be named registry in namespace quay")
components = {item["kind"]: item["managed"] for item in quay_registry["spec"]["components"]}
if components.get("route") is not True or components.get("tls") is not True:
    fail("Quay Route and TLS must remain operator managed")
expected_quay_host = f"registry-quay-quay.{target_values['cluster']['routerDomain']}"
if target_values["registry"]["quay"]["host"] != expected_quay_host:
    fail(f"Quay host must match the managed Route name: {expected_quay_host}")
if list((R / "tenants").rglob("*.yaml")) or list((R / "tenants").rglob("*.yml")):
    fail("the coordinated baseline must be valid with zero tenant manifest files")
if not (R / "components/gitea/kustomization.yaml").is_file():
    fail("Gitea must exist at components/gitea")
if not (R / "argocd/applications/gitea.yaml").is_file():
    fail("Gitea must have a normal Argo CD Application")


# Every ExternalSecret source property must exist in one of the two bootstrap files.
def env_keys(path: Path) -> set[str]:
    return {
        line.split("=", 1)[0]
        for line in path.read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }

# Public configuration is generated from Git; the one manual source is credentials-only.
bootstrap_config_kustomization = (R / "configuration/bootstrap/kustomization.yaml").read_text()
target_config_kustomization = (R / "configuration/targets/workshop/kustomization.yaml").read_text()
if "platform-bootstrap-config" not in bootstrap_config_kustomization or "../../config/platform.env" not in bootstrap_config_kustomization:
    fail("platform-bootstrap-config must be generated from config/platform.env")
if "platform-target-config" not in target_config_kustomization or "../../../targets/workshop/catalog-info.yaml" not in target_config_kustomization:
    fail("platform-target-config must be generated from the target catalog entity")
root_documents = list(yaml.safe_load_all((R / "bootstrap/root/application.yaml").read_text()))
root_project = next(document for document in root_documents if document.get("kind") == "AppProject")
if not any(item.get("namespace") == "cf-idp-secrets" for item in root_project["spec"]["destinations"]):
    fail("root AppProject must admit Git-managed configuration Secrets in cf-idp-secrets")
if {"group": "", "kind": "Secret"} not in root_project["spec"]["namespaceResourceWhitelist"]:
    fail("root AppProject must permit Git-managed configuration Secrets")
credential_only_forbidden = {
    "PLATFORM_REPO_URL", "PLATFORM_CONFIG_REVISION", "ROUTER_DOMAIN", "MICROCKS_URL",
    "APICURIO_API_URL", "QUAY_URL", "DEVELOPER_HUB_URL",
}
leaked_public_keys = credential_only_forbidden & env_keys(R / "bootstrap/secrets.env.example")
if leaked_public_keys:
    fail(f"credential source contains public configuration keys: {sorted(leaked_public_keys)}")

config_keys = env_keys(R / "config/platform.env") | {"platform.yaml"}
secret_keys = env_keys(R / "bootstrap/secrets.env.example")
platform_env = {
    line.split("=", 1)[0]: line.split("=", 1)[1]
    for line in (R / "config/platform.env").read_text().splitlines()
    if "=" in line and not line.lstrip().startswith("#")
}
expected_distribution = {
    "PLATFORM_CONFIG_REVISION": "main",
    "DEVELOPER_CHARTS_REVISION": "v1.0.0",
    "SOFTWARE_TEMPLATES_REVISION": "v1.0.0",
}
for key, expected_value in expected_distribution.items():
    actual_value = platform_env.get(key, "")
    if actual_value != expected_value:
        fail(f"{key} must be {expected_value}, got {actual_value}")
for path in [*R.glob("components/*/external-secret*.yaml"), R / "components/devspaces/oauth-secret.yaml", R / "components/pipelines/microcks-secret.yaml"]:
    if not path.exists():
        continue
    for document in yaml.safe_load_all(path.read_text()):
        if not document or document.get("kind") != "ExternalSecret":
            continue
        for item in document.get("spec", {}).get("data", []) or []:
            prop = item.get("remoteRef", {}).get("property")
            store = (
                item.get("sourceRef", {}).get("storeRef", {}).get("name")
                or document.get("spec", {}).get("secretStoreRef", {}).get("name")
            )
            allowed = config_keys if store == "cf-idp-config" else secret_keys if store == "cf-idp-secrets" else set()
            if store not in {"cf-idp-config", "cf-idp-secrets"}:
                fail(f"{path.relative_to(R)} uses unknown source store {store}")
            elif prop and prop not in allowed:
                fail(f"{path.relative_to(R)} references {prop} from the wrong or incomplete {store} source")

for path in R.glob("components/**/*.yaml"):
    source = path.read_text()
    if ".platformConfig | fromYaml" in source:
        if ".spec.platform" not in source:
            fail(f"{path.relative_to(R)} parses platform.yaml without reading target spec.platform")
        if "$p.platform" in source:
            fail(f"{path.relative_to(R)} still expects the removed top-level platform document")

# RHDH may read generated contracts only from the target-configured Apicurio v3 endpoint.
rhdh_external_secret = yaml.safe_load(
    (R / "components/developer-hub/external-secret.yaml").read_text()
)
rhdh_secret_data = (
    rhdh_external_secret.get("spec", {})
    .get("target", {})
    .get("template", {})
    .get("data", {})
)
registry_host_template = rhdh_secret_data.get("SCHEMA_REGISTRY_HOST", "")
if not all(token in registry_host_template for token in [
    ".platformConfig | fromYaml",
    ".spec.platform.schemaRegistry.apiUrl",
    "urlParse",
    ".host",
]):
    fail("rhdh-secrets must derive SCHEMA_REGISTRY_HOST from the target Registry API URL")

rhdh_config_map = yaml.safe_load((R / "components/developer-hub/app-config.yaml").read_text())
rhdh_app_config_source = rhdh_config_map.get("data", {}).get("app-config-rhdh.yaml", "")
if "${SCHEMA_REGISTRY_HOST}" not in rhdh_app_config_source:
    fail("RHDH app-config must reference SCHEMA_REGISTRY_HOST")
parseable_rhdh_config = rhdh_app_config_source.replace(
    "${SCHEMA_REGISTRY_HOST}", "schema-registry.example"
)
parseable_rhdh_config = re.sub(r"\$\{[^}]+\}", "placeholder", parseable_rhdh_config)
rhdh_app_config = yaml.safe_load(parseable_rhdh_config) or {}
reading_allow = (
    rhdh_app_config.get("backend", {})
    .get("reading", {})
    .get("allow", [])
)
registry_allow = next((item for item in reading_allow
    if item.get("host") == "schema-registry.example"), None)
if not registry_allow:
    fail("RHDH backend.reading.allow must reference SCHEMA_REGISTRY_HOST")
elif registry_allow.get("paths") != ["/apis/registry/v3/"]:
    fail("RHDH Registry read permission must be limited to /apis/registry/v3/")
if any(item.get("host") in {"*", "${ROUTER_DOMAIN}"} for item in reading_allow):
    fail("RHDH backend.reading.allow must not contain a wildcard or router-domain host")

# Profiles are explicit desired state, not generated state.
def resources(profile: str) -> set[str]:
    document = yaml.safe_load((R / "profiles" / profile / "kustomization.yaml").read_text())
    return set(document.get("resources", []))

full = resources("full")
workshop = resources("workshop")
minimal = resources("minimal")
tenant_admission = "../../argocd/applications/tenant-admissions.yaml"
gitea_application = "../../argocd/applications/gitea.yaml"
for profile_name, profile_resources in [
    ("full", full),
    ("workshop", workshop),
    ("minimal", minimal),
]:
    if tenant_admission not in profile_resources:
        fail(f"{profile_name} profile is missing generic tenant admission")
    if gitea_application in profile_resources:
        fail(f"{profile_name} profile must not select Gitea")
for required in [
    "../../argocd/operator-applications/cert-manager.yaml",
    "../../argocd/operator-applications/keycloak.yaml",
    "../../argocd/operator-applications/apicurito.yaml",
    "../../argocd/applications/apicurito.yaml",
]:
    if required not in full:
        fail(f"full profile is missing {required}")
for omitted in [
    "../../argocd/operator-applications/cert-manager.yaml",
    "../../argocd/operator-applications/keycloak.yaml",
    "../../argocd/operator-applications/apicurito.yaml",
    "../../argocd/applications/apicurito.yaml",
]:
    if omitted in workshop:
        fail(f"workshop profile must omit {omitted}")
if "../../argocd/applications/keycloak.yaml" not in workshop:
    fail("workshop profile must retain the independent Keycloak operand")
expected_minimal = {
    "../../configuration",
    "../../argocd/projects",
    "../../argocd/operator-applications/external-secrets.yaml",
    "../../argocd/applications/external-secrets.yaml",
    tenant_admission,
}
if minimal != expected_minimal:
    fail(f"minimal profile has unexpected resources: {sorted(minimal ^ expected_minimal)}")

pipelines_application = "../../argocd/applications/pipelines.yaml"
for profile_name, profile_resources in [("full", full), ("workshop", workshop)]:
    if pipelines_application not in profile_resources:
        fail(f"{profile_name} profile must install the shared Tekton Tasks")
pipelines_kustomization = (R / "components/pipelines/kustomization.yaml").read_text()
if "task-spectral.yaml" not in pipelines_kustomization:
    fail("pipelines component must install spectral-quality-gate")
spectral_task = yaml.safe_load((R / "components/pipelines/task-spectral.yaml").read_text())
if spectral_task.get("metadata", {}).get("name") != "spectral-quality-gate":
    fail("the installed Spectral Task must be named spectral-quality-gate")
if spectral_task.get("metadata", {}).get("namespace") != "tekton-tasks":
    fail("spectral-quality-gate must be installed in tekton-tasks")
pipelines_app = yaml.safe_load((R / "argocd/applications/pipelines.yaml").read_text())
tenant_admission_app = yaml.safe_load((R / "argocd/applications/tenant-admissions.yaml").read_text())
pipelines_wave = int(pipelines_app.get("metadata", {}).get("annotations", {}).get(
    "argocd.argoproj.io/sync-wave", "0"
))
tenant_wave = int(tenant_admission_app.get("metadata", {}).get("annotations", {}).get(
    "argocd.argoproj.io/sync-wave", "0"
))
if pipelines_wave >= tenant_wave:
    fail("shared Pipeline Tasks must reconcile before tenant admission")

# Mutable admission/configuration references and immutable dependencies are distinct.
tenant_app = yaml.safe_load((R / "argocd/applications/tenant-admissions.yaml").read_text())
if tenant_app["spec"]["source"]["targetRevision"] != "main":
    fail("tenant-admissions must watch the mutable configuration branch")
domain_template = (R.parent / "software-templates/templates/domain/template.yaml").read_text()
if "targetBranchName: ${{ steps.fetchTarget.output.entity.spec.platform.tenantAdmission.branch }}" not in domain_template:
    fail("Domain admission pull requests must target spec.platform.tenantAdmission.branch")
if "developerChartsRevision: ${{ steps.fetchTarget.output.entity.spec.platform.dependencies.developerCharts.revision }}" not in domain_template:
    fail("Domain admission must resolve the immutable developer-charts revision from the target entity")

# The Microcks external Helm Application is exact, multi-source, and has no OLM twin.
for removed in [
    "operators/microcks",
    "argocd/operator-applications/microcks.yaml",
    "components/microcks/apply-job.yaml",
]:
    if (R / removed).exists():
        fail(f"obsolete Microcks operator/apply artifact remains: {removed}")
microcks_app = yaml.safe_load((R / "argocd/applications/microcks.yaml").read_text())
microcks_sources = microcks_app.get("spec", {}).get("sources", [])
if len(microcks_sources) != 2:
    fail("Microcks Application must have exactly chart and Git values sources")
else:
    chart_source, git_source = microcks_sources
    expected_chart = ("https://microcks.io/helm", "microcks", "1.14.0")
    actual_chart = (chart_source.get("repoURL"), chart_source.get("chart"), str(chart_source.get("targetRevision")))
    if actual_chart != expected_chart:
        fail(f"Microcks chart source must be {expected_chart}, got {actual_chart}")
    if git_source.get("ref") != "values" or git_source.get("path") != "components/microcks":
        fail("Microcks Git source must use ref values and render component companions")
    for value_file in chart_source.get("helm", {}).get("valueFiles", []):
        if not value_file.startswith("$values/") or not (R / value_file.removeprefix("$values/")).is_file():
            fail(f"Microcks value file does not resolve in Git: {value_file}")
project = yaml.safe_load((R / "argocd/projects/platform-services.yaml").read_text())
if "https://microcks.io/helm" not in project.get("spec", {}).get("sourceRepos", []):
    fail("platform-services AppProject must admit the Microcks Helm repository")
for profile_name, profile_resources in [("full", full), ("workshop", workshop)]:
    for service_application in [
        "../../argocd/applications/quay.yaml",
        "../../argocd/applications/apicurio.yaml",
    ]:
        if service_application not in profile_resources:
            fail(f"{profile_name} profile must retain {service_application}")
    if "../../argocd/applications/microcks.yaml" not in profile_resources:
        fail(f"{profile_name} profile must retain the Microcks service Application")
    if any("operator-applications/microcks" in item for item in profile_resources):
        fail(f"{profile_name} profile must not select a Microcks operator")
for values_path in [R / "components/microcks/values.yaml", R / "targets/workshop/helm/microcks.yaml"]:
    values_text = values_path.read_text()
    for confidential_key in ["password:", "clientSecret:", "serviceAccountCredentials:"]:
        if confidential_key in values_text:
            fail(f"{values_path.relative_to(R)} contains a confidential Helm value: {confidential_key}")
microcks_target = yaml.safe_load((R / "targets/workshop/helm/microcks.yaml").read_text())
if f"https://{microcks_target['microcks']['url']}" != target_values["services"]["microcks"]["url"]:
    fail("Microcks chart URL drifted from platform.services.microcks.url")
if f"https://{microcks_target['keycloak']['url']}" != target_values["services"]["keycloak"]["url"]:
    fail("Microcks public Keycloak URL drifted from platform.services.keycloak.url")

# Argo directly owns products: no manifest-in-Secret apply reconciler may return.
for path in R.glob("components/**/*.yaml"):
    for document in yaml.safe_load_all(path.read_text()):
        if not document:
            continue
        if document.get("kind") == "Job":
            commands = str(document.get("spec", {}).get("template", {}).get("spec", {}).get("containers", []))
            if "oc apply" in commands or "kubectl apply" in commands:
                quay_output_secret = (
                    path.relative_to(R).as_posix() == "components/quay/bootstrap-job.yaml"
                    and "oc create secret generic quay-access-token" in commands
                    and "--dry-run=client" in commands
                )
                if not quay_output_secret:
                    fail(f"{path.relative_to(R)} applies a product manifest from a Job")
        if document.get("kind") == "ExternalSecret":
            template_data = document.get("spec", {}).get("target", {}).get("template", {}).get("data", {}) or {}
            for value in template_data.values():
                if isinstance(value, str) and "apiVersion:" in value and "\nkind:" in value:
                    fail(f"{path.relative_to(R)} hides a Kubernetes manifest in an ExternalSecret")

# Installation-specific URLs must not be embedded in Deployments.
for path in R.glob("components/**/*.yaml"):
    for document in yaml.safe_load_all(path.read_text()):
        if document and document.get("kind") == "Deployment" and "apps.example.cluster.com" in str(document):
            fail(f"{path.relative_to(R)} embeds an installation hostname in a Deployment")

# Required Roadie actions are backed by the RHDH 1.10-compatible dynamic plugin.
dynamic_plugins = (R / "components/developer-hub/dynamic-plugins.yaml").read_text()
roadie_package = "roadiehq-scaffolder-backend-module-utils:bs_1.49.4__4.1.2"
if roadie_package not in dynamic_plugins:
    fail("Developer Hub dynamic plugins must install Roadie utils 4.1.2 for Backstage 1.49.4")
template_tree = "\n".join(path.read_text() for path in (R.parent / "software-templates/templates").rglob("*.yaml"))
for action_id in [
    "roadiehq:utils:fs:parse", "roadiehq:utils:fs:write",
    "roadiehq:utils:jsonata",
]:
    if action_id not in template_tree:
        fail(f"software templates no longer exercise required Roadie action {action_id}")

direct_exception_doc = (R / "docs/architecture.md").read_text()
for key in ["APICURIO_APP_HOST", "APICURIO_UI_HOST", "QUAY_INTEGRATION_URL"]:
    if key not in direct_exception_doc:
        fail(f"retained direct scalar exception {key} is undocumented")

# Structural Kustomize traversal. This is intentionally local and does not
# emulate API admission; it catches missing resources and replacement paths.
import base64
class RenderError(Exception):
    pass

def load_documents(path: Path) -> list[dict]:
    return [doc for doc in yaml.safe_load_all(path.read_text()) if doc]

def read_field(obj, field_path: str):
    current = obj
    for part in field_path.split("."):
        current = current[int(part)] if isinstance(current, list) else current[part]
    return current

def write_field(obj, field_path: str, value) -> None:
    parts = field_path.split(".")
    current = obj
    for part in parts[:-1]:
        current = current[int(part)] if isinstance(current, list) else current[part]
    last = parts[-1]
    if isinstance(current, list):
        current[int(last)] = value
    else:
        current[last] = value

def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values

def render(kustomization: Path) -> list[dict]:
    config = yaml.safe_load(kustomization.read_text()) or {}
    documents: list[dict] = []
    for resource in config.get("resources", []) or []:
        if isinstance(resource, dict) or re.match(r"^https?://", str(resource)):
            continue
        path = (kustomization.parent / str(resource)).resolve()
        documents.extend(render(path / "kustomization.yaml") if path.is_dir() else load_documents(path))
    for generator in config.get("configMapGenerator", []) or []:
        data: dict[str, str] = {}
        for env_file in generator.get("envs", []) or []:
            data.update(parse_env((kustomization.parent / env_file).resolve()))
        documents.append({"apiVersion": "v1", "kind": "ConfigMap", "metadata": {"name": generator["name"]}, "data": data})
    for generator in config.get("secretGenerator", []) or []:
        data: dict[str, str] = {}
        for env_file in generator.get("envs", []) or []:
            for key, value in parse_env((kustomization.parent / env_file).resolve()).items():
                data[key] = base64.b64encode(value.encode()).decode()
        for file_spec in generator.get("files", []) or []:
            if "=" in file_spec:
                key, filename = file_spec.split("=", 1)
            else:
                filename = file_spec
                key = Path(filename).name
            data[key] = base64.b64encode((kustomization.parent / filename).read_bytes()).decode()
        metadata = {"name": generator["name"]}
        if generator.get("namespace"):
            metadata["namespace"] = generator["namespace"]
        documents.append({"apiVersion": "v1", "kind": "Secret", "metadata": metadata, "data": data})
    for replacement in config.get("replacements", []) or []:
        source = replacement["source"]
        matches = [
            doc for doc in documents
            if doc.get("kind") == source.get("kind")
            and (not source.get("name") or doc.get("metadata", {}).get("name") == source.get("name"))
        ]
        if len(matches) != 1:
            raise RenderError(f"{kustomization.relative_to(R)}: replacement source {source} matched {len(matches)} resources")
        value = read_field(matches[0], source["fieldPath"])
        for target in replacement.get("targets", []):
            selector = target.get("select", {})
            target_matches = []
            for doc in documents:
                metadata = doc.get("metadata", {})
                if selector.get("kind") and doc.get("kind") != selector["kind"]:
                    continue
                if selector.get("name") and metadata.get("name") != selector["name"]:
                    continue
                rejected = False
                for reject in target.get("reject", []) or []:
                    if reject.get("kind") and doc.get("kind") != reject["kind"]:
                        continue
                    if reject.get("name") and metadata.get("name") != reject["name"]:
                        continue
                    rejected = True
                    break
                if rejected:
                    continue
                target_matches.append(doc)
            if not target_matches:
                raise RenderError(f"{kustomization.relative_to(R)}: replacement target {selector} matched no resources")
            for doc in target_matches:
                for field_path in target.get("fieldPaths", []):
                    write_field(doc, field_path, value)
    return documents

for path in sorted(R.rglob("kustomization.yaml")):
    if "bootstrap/gitops" in str(path):
        continue
    try:
        render(path)
    except Exception as exc:
        fail(str(exc))

# The two root overlays select profiles only through declarative JSON patches.
for profile in ["full", "minimal"]:
    overlay = yaml.safe_load((R / "bootstrap/root" / profile / "kustomization.yaml").read_text())
    patch_text = "\n".join(item.get("patch", "") for item in overlay.get("patches", []))
    if f"value: profiles/{profile}" not in patch_text:
        fail(f"bootstrap/root/{profile} does not select profiles/{profile}")

if errors:
    print("Validation failed:")
    for error in errors:
        print(f" - {error}")
    sys.exit(1)

print("Validation passed: YAML, product contracts, secret keys, explicit profiles, and local Kustomizations")
