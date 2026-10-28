# Home map

Use Home map to arrange shared lights, rooms, scenes, Tasks, remotes and
information Cards on a floor plan. The editor is in **Controls → Home map**.
The separate viewer is available at `/home-map` on your server address.

## Create your map

1. Open **Controls → Home map → Edit layout**.
2. Enter a name. Choose **Upload floor plan** for a PNG, JPEG or WebP image,
   or keep the blank grid. A top-down plan or an isometric apartment illustration
   both work. Use an image you are permitted to use.
3. Find a target by name, select it and press **Add marker**. The choices come
   from your enabled remotes, shared lighting scenes, published Tasks and Cards
   supplied by enabled plugins. Share Tasks in **Controller setup**; configure
   remotes and scenes under **Controls**.
4. Drag the marker to its location. Select it to edit its label, glyph or X/Y
   position. Coordinates are percentages of the whole image. A focused marker
   can also be moved with arrow keys, or Shift + arrow for larger movements.
5. Use Copy to make a disabled duplicate, Enabled to show or hide a marker, and
   Delete to remove it from the layout. These edits do not affect devices.
6. Turn on **Share map**, then press **Save layout**. Open the map from the
   editor page, or visit `/home-map` from a desktop, tablet or phone on your LAN.

Uploads are staged until you save. Cancelling keeps the previous image and
layout. A staged image expires after 15 minutes; upload it again if the editor
asks. The editor converts images to PNG, resizing images larger than 4096 pixels
on their longest side. Input files can be up to 12 MiB; the resulting PNG must
fit within 6 MiB. Up to 128 markers are supported. The server retains only
validated image content, not the uploaded image's descriptive metadata.

## Use the map

- Select a light or room to adjust its supported power, brightness, warmth or
  colour controls. Reported values are separate from an adjustment you selected.
- Select a scene, then **Apply scene**, or a Task, then **Run task**.
- A remote opens its full existing remote; a Card opens its information view.
- Use + and − to zoom, scroll to pan, or **Fit** to return to the whole map.

The page refreshes while visible. It retains markers and an open remote while
readings change. Connection loss, stale lighting readings, disabled targets and
server pause prevent new device commands. Removed or unpublished targets keep
their marker location but become unavailable; edit the layout to replace them.
Commands are never automatically resent. If a result is uncertain, check the
device or Task history before trying again.

The map follows the **display** theme, palette and font size from Server
settings, independently of administrator appearance. It uses existing public
Controls and Task permissions; it does not grant access to new capabilities.

## Storage and privacy

The layout is stored in `data/home-map.json`. Managed images are stored under
`data/home-map/images/`. Include those files in your own private backups.
Neither the layout nor uploaded images are included in clean GitHub source or
installation packages. A fresh installation starts with a disabled blank map.

An enabled map and its current floor plan can be viewed by people with access
to your server on the trusted local network. Disable the map to remove its
public image and marker access. This does not remove the original remotes or
Task shortcuts from other pages. The administrator can preview a disabled map.

The illustration and marker positions are a visual aid, not a measured building
model. Changing an image preserves percentage positions; reposition markers if
the new plan uses a different crop or camera angle.
