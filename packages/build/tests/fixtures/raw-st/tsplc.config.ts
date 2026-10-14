import { defineConfig } from "@tsplc/config";

export default defineConfig({
  backend: "codesys",
  build: {
    template: "base.project",
    sourceDir: "src",
    entry: "src/Main.st",
  },
});
