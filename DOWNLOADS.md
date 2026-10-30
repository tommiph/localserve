# Downloads

Open **Administration → Downloads** for application packages, TV sources and
Google Apps Script files. Versions refer to these files, not to an app installed
on another device. Refresh checks the files again.

- **Controller** is the phone app for scenes, Tasks, remotes, Cards and sensor reporting. Install it over the existing app to retain
  its settings, then use **Controls → Controller setup** to connect and choose Tasks.
- **Sormus Downloads** is the separate Android file receiver for Downloads inbox. Pair it from the plugin's Transfers tab; received shares and links send automatically after pairing.
- **Sormus Vistas**, **Sormus Launcher** and **PlayStation TV app** are signed widgets when built on
  this server. Installation requires an authorized Tizen developer connection.
- **TV source ZIPs** contain application sources without signing keys or configured
  addresses. Build and sign them with your own Tizen SDK and certificate.
- **Oculus Go app** is for the headset. Use authorized headset tools to install it;
  it is not another phone app.
- **Code.gs** is the public Google Apps Script relay source. Follow the plugin's
  setup instructions to deploy it in your own Google account.
- **Private Google configuration** contains credentials. Use it only in your own
  Google project; never share it or put it in a public repository.

The Windows installer and portable ZIP are linked to GitHub's published releases.
An unpublished local server can be newer than those downloads. A missing package
is shown as unavailable rather than linked to a broken or unchecked file.

Controller's own update button remains available in its Settings.

## Send files to this PC

The **Downloads inbox** plugin and separate **Sormus Downloads** Android app receive phone files and start torrent downloads through the installed PC qBittorrent client. See [Phone files and torrents](FILE-DOWNLOADS.md).
