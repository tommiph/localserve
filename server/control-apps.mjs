/** Installation metadata only. A manifest never contains a Control capability,
 * action arguments, readings or device credentials; opening the app still uses
 * the live, revision-checked Controls client. */
export function controlAppManifest({ plugin, page }, serverName) {
  const supported = page.presentation === 'television' && plugin.controls?.television
    || page.presentation === 'lighting' && plugin.controls?.lighting;
  if (!supported) return null;

  const url = `/controls/${plugin.id}/${page.slug}`;
  return {
    // Keep installation identity independent of names, revisions and the slug.
    // Scope affects browser navigation only; it grants no API permissions.
    id: `/controls/${plugin.id}/app-${page.id}`,
    name: `${page.name} · ${serverName}`,
    short_name: page.name,
    start_url: url,
    scope: url,
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    lang: 'en',
    prefer_related_applications: false,
    icons: [192, 512].map(size => ({
      src: `/assets/controls/app-icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any maskable',
    })),
  };
}

export function controlAppHead(manifest) {
  if (!manifest) return '';
  const escape = value => value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  return `<link rel="manifest" href="${manifest.start_url}/app.webmanifest">\n`
    + `  <meta name="application-name" content="${escape(manifest.name)}">\n`
    + `  <meta name="apple-mobile-web-app-title" content="${escape(manifest.short_name)}">`;
}
