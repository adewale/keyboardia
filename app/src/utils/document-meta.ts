/**
 * Document Meta Utilities
 *
 * Updates document title and meta tags for SEO.
 * Used by SessionName to set dynamic titles for session pages.
 */

const DEFAULT_TITLE = 'Keyboardia — Collaborative Step Sequencer';
const DEFAULT_DESCRIPTION = 'Create beats together in real-time. A multiplayer step sequencer with instant creation, real-time collaboration, and GitHub-style remixing.';

/**
 * Update document title and Open Graph meta tags for a session
 */
export function setSessionMeta(sessionName: string | null, sessionId?: string): void {
  const displayName = sessionName || 'Untitled Session';
  const title = `${displayName} — Keyboardia`;
  const description = `Listen to "${displayName}" on Keyboardia. Create beats together in real-time.`;
  const url = sessionId ? `https://keyboardia.dev/s/${sessionId}` : 'https://keyboardia.dev/';

  // Update title
  document.title = title;

  // Update meta tags
  updateMetaTag('name', 'title', title);
  updateMetaTag('name', 'description', description);

  // Open Graph
  updateMetaTag('property', 'og:title', title);
  updateMetaTag('property', 'og:description', description);
  updateMetaTag('property', 'og:url', url);

  // Twitter
  updateMetaTag('property', 'twitter:title', title);
  updateMetaTag('property', 'twitter:description', description);
  updateMetaTag('property', 'twitter:url', url);
}

/**
 * Reset document meta to default landing page values
 */
export function resetDocumentMeta(): void {
  document.title = DEFAULT_TITLE;

  updateMetaTag('name', 'title', DEFAULT_TITLE);
  updateMetaTag('name', 'description', DEFAULT_DESCRIPTION);

  updateMetaTag('property', 'og:title', DEFAULT_TITLE);
  updateMetaTag('property', 'og:description', DEFAULT_DESCRIPTION);
  updateMetaTag('property', 'og:url', 'https://keyboardia.dev/');

  updateMetaTag('property', 'twitter:title', DEFAULT_TITLE);
  updateMetaTag('property', 'twitter:description', DEFAULT_DESCRIPTION);
  updateMetaTag('property', 'twitter:url', 'https://keyboardia.dev/');
}

/**
 * Helper to update a meta tag by attribute selector
 */
function updateMetaTag(attr: 'name' | 'property', key: string, content: string): void {
  const selector = `meta[${attr}="${key}"]`;
  const meta = document.querySelector(selector);
  if (meta) {
    meta.setAttribute('content', content);
  }
}
