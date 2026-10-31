// Railway (the hosted Freero). Builds the repo's Dockerfile; a deploy only takes traffic once
// /readyz answers (database and storage reachable). A crashed process restarts (Railway's default:
// on failure, 10 retries). Variables are set on Railway, never here: this file is public.
// Change it, then `railway config plan` and `railway config apply`. From Git Bash on Windows run the
// CLI as  _="$EXE" "$EXE" config plan  with EXE the full path to railway.exe: the SDK runs $_ to
// check the CLI version, and Git Bash leaves a shell-script path there.
import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "freero";
export default defineRailway(() => {
  const freero = service("freero", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/readyz",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
  });

  return project("freero", {
    variables: { managed: false },
    resources: [freero],
  });
});
