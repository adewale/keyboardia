/**
 * Social Media Preview Module
 *
 * Handles crawler detection and dynamic meta tag injection for social sharing.
 * Uses HTMLRewriter for streaming HTML transformation.
 */

/**
 * Regex to detect social media crawlers via User-Agent
 */
const SOCIAL_CRAWLER_REGEX = /facebookexternalhit|facebot|twitterbot|linkedinbot|discordbot|slackbot|whatsapp|telegrambot/i;

/**
 * Session metadata for social previews
 */
export interface SessionMeta {
  id: string;
  name: string | null;
  trackCount: number;
  tempo: number;
}

/**
 * Check if the request is from a social media crawler
 */
export function isSocialCrawler(request: Request): boolean {
  const userAgent = request.headers.get('User-Agent') || '';
  return SOCIAL_CRAWLER_REGEX.test(userAgent);
}

/**
 * Escape HTML special characters to prevent XSS in meta tag content.
 * Session names are user-provided and could contain malicious characters.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Generate JSON-LD structured data for Schema.org
 *
 * Uses MusicComposition rather than MusicRecording because:
 * - Sessions are interactive compositions, not fixed recordings
 * - Sessions loop infinitely (no duration)
 * - No actual audio file exists at the URL
 *
 * Keyboardia is listed as composer (Organization) until we have user accounts.
 */
function generateJsonLd(session: SessionMeta, url: string, baseUrl: string): string {
  // XSS prevention: escape session name for JSON context
  const safeName = session.name ? escapeHtml(session.name) : 'Untitled Session';
  const ogImage = `${baseUrl}/og/${session.id}.png`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'MusicComposition',
    'name': safeName,
    'url': url,
    'image': ogImage,
    'composer': {
      '@type': 'Organization',
      'name': 'Keyboardia',
      'url': baseUrl,
      'logo': `${baseUrl}/icon-192.png`,
      'description': 'Collaborative step sequencer for creating beats together in real-time'
    }
  };

  return `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

/**
 * Inject social media meta tags into HTML response using HTMLRewriter
 * @param response - The base HTML response to transform
 * @param session - Session metadata for the preview
 * @param baseUrl - The base URL of the current environment (e.g., https://staging.keyboardia.dev)
 */
export function injectSocialMeta(
  response: Response,
  session: SessionMeta,
  baseUrl: string
): Response {
  // XSS prevention: escape user-provided session name
  const safeName = session.name ? escapeHtml(session.name) : null;

  const title = safeName
    ? `${safeName} — Keyboardia`
    : 'Untitled Session — Keyboardia';

  const description = safeName
    ? `Listen to "${safeName}" on Keyboardia. A ${session.trackCount}-track beat at ${session.tempo} BPM. Create beats together in real-time.`
    : `Listen to this beat on Keyboardia. A ${session.trackCount}-track composition at ${session.tempo} BPM. Create beats together in real-time.`;

  const url = `${baseUrl}/s/${session.id}`;
  const ogImage = `${baseUrl}/og/${session.id}.png`;

  // Track if we've appended to head (to avoid duplicates)
  let headAppended = false;

  return new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(title);
      }
    })
    .on('meta[name="title"]', {
      element(el) {
        el.setAttribute('content', title);
      }
    })
    .on('meta[name="description"]', {
      element(el) {
        el.setAttribute('content', description);
      }
    })
    .on('meta[property="og:title"]', {
      element(el) {
        el.setAttribute('content', title);
      }
    })
    .on('meta[property="og:description"]', {
      element(el) {
        el.setAttribute('content', description);
      }
    })
    .on('meta[property="og:url"]', {
      element(el) {
        el.setAttribute('content', url);
      }
    })
    .on('meta[property="og:image"]', {
      element(el) {
        el.setAttribute('content', ogImage);
      }
    })
    .on('meta[property="twitter:title"]', {
      element(el) {
        el.setAttribute('content', title);
      }
    })
    .on('meta[property="twitter:description"]', {
      element(el) {
        el.setAttribute('content', description);
      }
    })
    .on('meta[property="twitter:url"]', {
      element(el) {
        el.setAttribute('content', url);
      }
    })
    .on('meta[property="twitter:image"]', {
      element(el) {
        el.setAttribute('content', ogImage);
      }
    })
    .on('head', {
      element(el) {
        if (headAppended) return;
        headAppended = true;
        // Inject additional OG tags and JSON-LD (not in static HTML)
        el.append(`<meta property="og:site_name" content="Keyboardia" />`, { html: true });
        el.append(`<meta property="og:image:width" content="600" />`, { html: true });
        el.append(`<meta property="og:image:height" content="315" />`, { html: true });
        el.append(generateJsonLd(session, url, baseUrl), { html: true });
      }
    })
    .transform(response);
}
