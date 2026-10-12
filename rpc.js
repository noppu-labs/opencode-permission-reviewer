// biome-ignore lint/performance/noBarrelFile: shipped root shim (package.json "files") re-exporting the ReviewerRpc protocol from dist/rpc.js; the re-export is its public API
export { ReviewerRpc, ReviewerRpc as default } from "./dist/rpc.js";
