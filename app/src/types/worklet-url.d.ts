/**
 * Type declarations for Vite's ?worker&url import suffix.
 * These imports return a URL string to a compiled worker/worklet asset.
 */
declare module '*?worker&url' {
  const url: string;
  export default url;
}
