import * as tcx from "./tcx_wasm.js";

window.__imTokenTcxWasmModule = tcx;
window.dispatchEvent(new CustomEvent("imtoken:tcx-wasm-ready"));
