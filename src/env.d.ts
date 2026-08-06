/**
 * Build stamps injected by Vite's `define` (see vite.config.ts). They let
 * Settings show which build is running, so "did the update actually land?"
 * has an answer the user can read rather than guess at.
 */
declare const __BUILD_TIME__: string;
/** Short commit SHA in CI; empty string for a local build. */
declare const __BUILD_SHA__: string;
