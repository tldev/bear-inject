/**
 * bear-inject: inject snippets into a Bear Blog at the Cloudflare edge.
 * Package entry. See README.md for the CLI and consumer workflow.
 */
export { createWorker } from "./worker.js";
export { renderSnippets, applyInjection, PLACEMENTS } from "./inject.js";
