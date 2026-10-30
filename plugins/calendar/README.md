# Calendar

Subscribed calendars, local dates, countdowns and Task reminders

## Setup

Add your own complete public HTTPS/webcal ICS subscription URL. No subscription is supplied. Reminder checks use cached agenda data; feed refresh is separate. No authenticated CalDAV, calendar edits or attachment downloads are provided.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Reminder check interval**: Checks the cached agenda. Task reminders run on the next check after their due time.. Choices: 1 minute, 2 minutes, 5 minutes.
- **Feed refresh interval**: Per enabled calendar. Feed failures pause reminders until a successful refresh.. Choices: 5 minutes, 15 minutes, 30 minutes, 1 hour.
- **Calendars and dates**: Choose a read-only subscription or a local date/countdown. Local dates need no subscription or account. All local times use the server’s system timezone..
  - **Calendar ID**: string
  - **Name**: string
  - **Source**: string
  - **Subscription URL** (private secret): Complete public HTTPS feed address. webcal links use HTTPS. No sign-in, redirects, attachments or linked pages are opened.
  - **Target date**: Server local date, 1970–9999. A missing daylight-saving minute is rejected.
  - **Target time**: Server local time, to the minute. Date reached emits on the next active check; missed checks do not replay.
  - **Reminder before event (minutes)**: Whole minutes before the start; 0 disables upcoming reminders. Event started and ended remain available to Tasks.
  - **Enabled**: boolean

## Actions and events

Actions: Check calendar.

Events: Calendar reading updated; Event upcoming; Event started; Event ended; Countdown updated; Date reached.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Agenda, Agenda · Fullscreen, Countdown, Sci-fi console, Hacker terminal, Rustic almanac, LCARS display. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
