# Devices

Open **SERVER → Devices** (or `/devices`), choose an attached network and select **Discover
devices**. Opening the page, restarting Sormus and ordinary administrator
refreshes never start a scan.

Sormus checks at most 254 addresses in an attached private IPv4 /24 segment.
Narrower adapter subnet masks restrict that range further. Windows performs
bounded ICMP checks and reads that adapter's neighbor cache. Temporary UDP
sockets query mDNS/DNS-SD and SSDP/UPnP; matching HTTP UPnP descriptions can
provide a friendly name, manufacturer and model. Reverse DNS uses the PC's
configured resolver. Discovery does not contact an external manufacturer
service, change the firewall, install software, pair or control devices.

## Reading the list

Expand **Details** to inspect reported names, services and evidence. Types
inferred from advertised services are marked **Inferred**. A media renderer is
shown as a media device rather than assumed to be a TV. Unknown details stay
unknown. A cached MAC address does not prove that a device currently responds;
the list distinguishes cached information from an observed response and shows
the response time. Missing a device in a scan is not proof that it is offline.
Sleeping devices, isolated Wi-Fi clients and devices that block discovery may
not appear. Discovery is not authentication or a complete asset inventory.

**Edit** supplies a local name and type override. **Copy address** copies the
IPv4 address. Disabling an inventory entry prevents **Use address**; it does not
block the device, disable its plugins or exclude discovery replies. **Forget**
removes the entry and overrides; another scan can discover it again. Overrides
follow an observed MAC address when available. Randomized MACs can change.
Without a MAC, the entry identifies an address only, and a different device may
later reuse that address.

## Manufacturer lookup

Choose **Look up manufacturers** to enrich enabled inventory entries using
[MACLookup](https://maclookup.app/api-v2/documentation). No account or API key is
required. Only the first six hexadecimal digits of public MAC addresses are
sent to the fixed HTTPS API. Device names, IP addresses and full MAC addresses
are not sent. The provider also sees the server's public connection address.
Locally administered/private MACs and entries without a MAC are skipped.

The list shows the MAC block registrant; **Details** includes country, business
address, assignment type, registry update date and lookup time. These describe
the registration, not a verified device brand, model or type. Reported device
manufacturers and your custom labels remain separate. Search includes company
and country. A missing registration stays explicitly **not found**.

Lookups start only from this button, never from scans, page reads, refreshes or
startup. Registrations are cached for 30 days; missing results for seven days.
Expired results stay visible and refresh only on another manual lookup. One
batch checks up to 64 uncached prefixes, at most two requests per second, with
six-second request and three-minute batch limits. Shared prefixes use one
result. Provider rate limits stop the batch and persist the next allowed time;
there are no automatic retries. **Stop lookup**, server pause and shutdown
cancel pending work; results already saved remain available. Scans and lookups
share a single operation slot.

The private cache is stored in `data/device-vendors.json` and excluded from
all distributions. A malformed cache disables lookup only, preserving the
inventory and original cache file.

## Use an address

Choose **Use address**, select an installed compatible plugin, review the
proposed setting and choose **Save address**. Supported targets are Samsung TV,
TRÅDFRI, Oculus Go and Emby when their declared address fields are present.
Discovery does not prove compatibility; select the correct device yourself.
Existing Oculus/Emby ports are preserved; unconfigured connections use ADB 5555
or Emby HTTP 8096. The proposed value is shown before saving. Other settings,
credentials and enablement are preserved. Saving can reconnect an enabled
plugin. Existing certificate, serial and authorization checks still apply;
this operation never authorizes a new device or starts pairing.

## Operation and storage

One scan can run at a time, with a 45-second overall limit. **Stop scan**, server
pause and shutdown cancel pending discovery. Previous results are retained when
a scan cannot complete. Partial protocol failures appear in the scan summary.
At most 512 device entries are retained, with no recurring scan or presence
history. Inventory and custom labels are private installation data in
`data/devices.json`; distributions exclude this file. Invalid saved inventory
disables this page's changes without overwriting the original file.

Scans and edits use the administrator's Origin/token checks. Settings writes use
normal revision checks. Discovery does not emit Task Events or automatically
update plugin addresses. There is no port scan, router login or DHCP lease API.

Implementation: `server/devices.mjs`, `server/device-discovery.mjs`,
`server/devices-windows.ps1`, `server/device-vendors.mjs` and `web/devices-ui.js`. Tests use injected workers,
synthetic protocol packets and disposable stores; they do not scan a real LAN.
