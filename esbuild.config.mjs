import { build } from "esbuild";

await build({
  entryPoints: ["src/handler.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "dist/handler.mjs",
  format: "esm",
  external: ["@aws-sdk/*"],
  minify: true,
  sourcemap: true,
});
