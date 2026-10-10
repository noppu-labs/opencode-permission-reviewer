// biome-ignore lint/performance/noBarrelFile: root shim for the "./rpc" package export (dist/rpc.js); the re-export is the public API
export { ReviewerRpc, ReviewerRpc as default } from "./dist/rpc.js";
