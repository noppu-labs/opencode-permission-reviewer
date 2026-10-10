// Directory entrypoint for hosts that resolve local plugins by filename.
// biome-ignore lint/performance/noBarrelFile: root shim for hosts that load local plugins by filename; the re-export is the package entry
export { default } from "./dist/index.js";
