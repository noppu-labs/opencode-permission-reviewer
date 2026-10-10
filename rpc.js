// biome-ignore lint/performance/noBarrelFile: shipped root shim (package.json "files") re-exporting dist/rpc.js, for hosts that resolve plugins by filename
export { ReviewerRpc, ReviewerRpc as default } from "./dist/rpc.js";
