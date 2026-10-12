// biome-ignore lint/performance/noBarrelFile: shipped root shim (package.json "files") re-exporting dist/tui/tui.tsx, for hosts that resolve plugins by filename
export { default } from "./dist/tui/tui.tsx";
