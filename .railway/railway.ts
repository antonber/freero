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
