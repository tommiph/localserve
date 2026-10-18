# News

Headlines from Google News RSS

## Setup

Add a Search using its complete HTTPS Google News RSS Feed URL. Each feed URL supplies its own query/language/edition parameters. No personal searches or subscriptions are included; article pages/images are not downloaded.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Polling interval**: Applies to each enabled search. Requests are staggered across the interval.. Choices: 15 minutes, 30 minutes, 45 minutes, 1 hour.
- **Searches**: Add named locations or topics for separate headlines, card fields, and Task events..
  - **Search ID**: string
  - **Name**: string
  - **Feed URL**: Paste the whole Google News RSS Feed URL, including all query parameters. Use the complete URL generated for your specific Google News search, topic, language, or edition. Example: https://news.google.com/rss/search?q=Kerava&hl=fi-FI&gl=FI&ceid=FI:fi
  - **Enabled**: boolean

## Actions and events

Actions: Refresh news.

Events: News updated.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Front page. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
