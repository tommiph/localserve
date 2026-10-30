# Phone files and torrents

Use the **Downloads inbox** plugin to send files from Android to the PC's Downloads folder. Install its separate **Sormus Downloads** Android app, pair it from the plugin's Transfers tab, then choose files or use Android's Share menu.

Magnet links and `.torrent` files can open Sormus Downloads. On a paired phone, received files and links send automatically without opening the Downloads workspace. The installed qBittorrent 5 client downloads torrent contents into the configured destination. The app’s own picker retains **Send to PC**. In plugin Settings, **Torrent content location → Let qBittorrent choose** instead uses the PC client’s own destination and Add Torrent dialog preference; normal phone uploads keep their Downloads inbox destination. Android browsers may keep ordinary web links; Share → Sormus Downloads is the fallback. Completion and torrent controls remain in qBittorrent on the PC.

The Transfers tab also provides browser uploads, torrent submission, progress, receipts and phone disconnection. Keep phone and PC on the same trusted LAN. See the [plugin guide](plugins/downloads-inbox/README.md) for limits, interrupted transfers, privacy and setup.
