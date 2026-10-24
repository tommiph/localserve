# Google Apps Script relay

Use your own Google Apps Script project to receive selected phone reports,
lighting-scene requests, published Task shortcuts and external messages while
away from home. Localserve polls that inbox using outbound HTTPS. Your PC
does not need a public address, forwarded port or externally accessible admin.
This is a low-rate message relay, not a VPN or remote browser for Localserve.

The plugin starts disabled. LAN operation remains available without Google.
Remote use requires Localserve 0.41.0, Controller for Android 2.1.0,
a running home server and internet access at both ends.

## 1. Prepare the relay in Localserve

1. Open **Google Apps Script → Settings** in administration.
2. Choose **Generate missing keys**. The collector key lets your home server
   synchronize its private relay. Existing valid keys are retained.
3. Download **Code.gs** and **private Google configuration**. The script contains
   no credentials. The private configuration does: never share or publish it.
4. New Controller phones use the approval flow below. For an external sender,
   add an Authorized client with a unique lowercase ID, descriptive name and
   only the permissions it needs. The ID collector is reserved for the server.

## 2. Deploy the Google project

1. Create a standalone project at [Google Apps Script](https://script.google.com/).
2. Replace its code with the downloaded `Code.gs` and save it.
3. In **Project Settings → Script Properties**, add a property named
   `LOCAL_SERVE_RELAY`. Paste the entire private Google configuration JSON as
   the value. Restrict editor access to people you trust with those credentials.
4. Choose **Deploy → New deployment → Web app**. Execute as **yourself** and
   allow **Anyone**, including callers not signed into Google. The script
   authenticates every data request with its signed body. Some managed Google
   accounts disallow anonymous deployments; the plugin cannot bypass that policy.
5. Complete Google's deployment prompts and copy the deployed HTTPS URL ending
   in `/exec`, not the editor URL or a `/dev` testing URL.
6. Save that URL in Localserve's **Apps Script deployment URL** and enable the
   plugin. A successful poll updates **Last successful sync** and the plugin Log.

The web-app settings and response redirect follow Google's
[web-app guide](https://developers.google.com/apps-script/guides/web) and
[Content Service guide](https://developers.google.com/apps-script/guides/content).
When updating script code, deploy a new version through **Manage deployments**
so the saved `/exec` deployment serves it. Editing code alone is insufficient.

## 3. Connect Controller

1. Install `/downloads/controller.apk` on the phone.
2. At home, open Controller → Settings, enter the Localserve LAN address and Connect.
3. On a new phone, Controller asks for approval. In administration, choose
   **Google Apps Script → Settings → Approve a phone**. Enter its six-character
   code in Controller. The code works once, expires after five minutes and is
   invalidated after eight failed attempts. Generating another cancels the old one.
4. Localserve creates this phone's individual relay client and transfers its
   connection details automatically. Its next successful Google sync registers
   the client remotely. No JSON, keys or device IDs are handled on the phone.
5. Lights and published Tasks are available locally and through the relay. Full
   Remotes and Cards require LAN. The app prefers LAN and checks for its return.
6. Open Settings → Phone reporting, select sources, grant Android access and tap
   Start if reporting is wanted. Connection never starts reporting automatically.

Phone approval grants Lights, published Tasks and optional sensor reports,
never generic Task Events. Existing configured relay phones retain access during
an app upgrade; existing disabled grants are not re-enabled. Administration owns
client permissions, the Google deployment and Task publishing. See [Controller setup and troubleshooting](CONTROLLER.md).
The app never automatically resends a command through another transport. Queued
means Google accepted the request; Completed comes from the normal local receipt.
Cloud shortcuts expire after 90 seconds and the catalogue after 120 seconds
without synchronization. Keep the server running.

## 4. Phone reports

The defaults are a 60-second server poll and a 120-second cloud report interval.
**Cloud sensor interval** is 60–600 seconds; the exported phone profile sets its
minimum send interval. Open Controller at home to retrieve updated connection details. Google
keeps only the newest pending sensor report per client. The phone maintains no
offline report queue or location history. A failed upload is followed by the
next fresh snapshot, not a replay. Delayed or expired data can be dropped.
Very brief gestures or callbacks can be missed at this cadence. LAN mode remains
the appropriate choice for rapid motion/pickup automation or live gauges.

Remote presence has separate **Relay reports resumed** and **No recent relay
reports** Events. It never generates **LAN reports resumed** or **No recent LAN
reports**, so an existing LAN-presence rule does not mistake remote reachability
for arriving home. Relay absence uses the report interval plus the server poll
interval and a 15-second allowance, checked by normal Sensors maintenance.
Neither transport proves a person's location. A reported Wi-Fi connection can
be any Wi-Fi network; do not use `wifi=true` alone to identify your home network.

Selected location, notification, media and other phone sources can contain
personal information. Opting them into relay reporting sends their selected
contents through Google as well as Localserve. Android permissions, notification
allowlists and source switches still apply. Unselected sources are not enabled
by the relay. Task runs may retain captured public Event fields according to
normal Localserve logging/history rules.

## 5. Receive an external message as a Task Event

Create an enabled client with **Allow generic Task events**. Export its private
profile and keep it on the sending machine outside version control. From a
Localserve source folder, send one explicit message:

```powershell
.\runtime\node.exe plugins/google-apps-script/server/apps-script/send-example.mjs localserve-my-phone-private.json arrival "I am on my way"
```

This prints a request ID and queue status, never the key. In Tasks, add a rule
using **Google Apps Script → Message received**, filter its Client ID or Channel,
and use the public fields from the value picker. Fields are `message-id`,
`client-id`, `channel`, `message`, `value`, `active` and `sent-at` (epoch ms).
For example, `{{event.message}}` inserts the message in a Log activity action.
The example sends Channel and Message; protocol clients may also supply a finite
numeric Value and boolean Active. Zero and false are valid values. Messages
expire after five minutes. No text is evaluated as code or an action name.

## Receipts, limits and troubleshooting

- **Last successful sync** and recent relay receipts are under the plugin's
  Settings; synchronization errors are in its Log. **Received** means a report
  or Event was admitted, not that every matching Task completed. Inspect normal
  Task runs for action results. **Rejected** includes permission, stale shortcut
  or invalid report failures. **Interrupted** is not replayed automatically.
- Keep PC and phone clocks synchronized. Signed requests/replies require clocks
  within two minutes; queued sensor reports have a 90-second freshness limit.
- The inbox holds at most 40 pending slots, with one latest sensor slot per
  client, a maximum 20-message poll batch and bounded payload/storage sizes.
  Receipt metadata is visible for up to 20 minutes; it contains no message text
  or sensor callback content. The server retains at most 256 such records.
  Expiry prevents admission or display; physical cleanup runs on the next
  authenticated cloud request or local sync/startup. Inactive Google projects
  can still hold expired records. Delete their Script Properties or the project
  to remove stored relay data when retiring a deployment.
- Use this for a small number of low-rate clients. Each request reads/writes
  Google Script Properties. Faster polling, several active phones and large
  reports consume the account's daily quota; a configured client limit is not a
  throughput guarantee. Increase polling/report intervals or reduce sources if
  synchronization fails. Google's quotas can change; consult the current
  [quota table](https://developers.google.com/apps-script/guides/services/quotas).
  Incoming requests here do not use Apps Script's separate URL Fetch allowance.
- A successful cloud connection needs no inbound firewall change on the PC.
  An HTML login page, unexpected redirect or unsigned response is rejected.
  Check the deployment's access setting and `/exec` URL rather than disabling
  authentication or TLS checks.
- Disabling a local client or permission blocks new local execution immediately.
  The next successful sync also propagates those flags to existing Google
  clients. For new clients or key rotation, replace `LOCAL_SERVE_RELAY` with a
  fresh private configuration export and update that phone's private profile.
  Old-key queued messages cannot acquire the new key's local authority. To stop
  cloud collection immediately, revoke the Google deployment or its client too;
  disabling Localserve alone cannot remove data already submitted to Google.

## Contributor contract

`plugins/google-apps-script/server/apps-script/Code.gs` is the complete cloud
source. It uses Script Properties and a script lock; no Drive or Sheet access
is needed. HMAC-SHA256 authenticates the version, client, operation, timestamp,
nonce and base64 JSON body over HTTPS. Credentials are UTF-8 key strings, not
decoded hexadecimal bytes. Node and Android share golden protocol tests. The
Google Content Service redirect is followed only as a GET to its fixed content
host/path, with no signed POST body forwarded to that redirect.

The optional plugin worker has a scoped host operation for catalogue, admission
and receipts. Host-side durable claims precede normal phone-shortcut/Controls
execution, Sensors ingress or Event emission. Pause, runtime/configuration
revision and shutdown guards remain authoritative. A crash can leave a message
interrupted or an Event undelivered; the contract prevents automatic replay and
does not promise exactly-once effects. Saved scene/Task definitions are never
rewritten by relay delivery.

Private client profiles and configuration are administration-only explicit
exports. They are not public assets or distribution inputs. Both Android apps
use native HTTPS transport; cloud responses cannot execute in a WebView and no
native JavaScript bridge is introduced. Tests use synthetic keys, simulated
Google services and disposable stores; live Google deployments and physical
phones require separate end-to-end qualification.
