# Webpage

Embedded webpages, parsed text and page change events

## Setup

Add a named public HTTP/HTTPS page for bounded HTML/text reads; arbitrary private/local targets and redirects are rejected. Alternatively add your own display HTML under assets/pages/ and save its /assets/pages/name.html path. These local pages are display-only and never polled. Open on TV requires your own ready Samsung TV plugin and compatible Vista Tizen app. No personal pages or saved Page entries are included.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Polling interval**: Applies to public webpages. Sormus display pages are display-only and are not polled. Successful public refreshes reload embedded Cards; page-change events compare downloaded HTML.. Choices: 5 minutes, 10 minutes, 15 minutes, 30 minutes, 1 hour, 2 hours, 3 hours, 6 hours, 12 hours, 24 hours.
- **Pages**: Use public HTTP/HTTPS URLs, /assets/pages/name.html for a local display, /universe for Universe, or /phone-information for phone readings. Local displays support Open on TV without polling or parsed readings. Copies start disabled..
  - **Page ID**: string
  - **Name**: string
  - **Webpage URL**: Public URL without passwords/custom ports, /assets/pages/name.html, /universe, or /phone-information. Other local/private URLs remain unavailable. Use the final public URL when a site redirects.
  - **Parse text**: boolean
  - **Enabled**: boolean

## Actions and events

Actions: Refresh webpage; Open on TV.

Events: Page changed.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Sci-fi console, Hacker terminal, Rustic almanac, LCARS display. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
