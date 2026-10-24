# Sensors

Selected sensor and phone reports from trusted Android devices on the local network

## Setup

Enable Sensors, open /sensors on Android and install the APK. Enter this server’s private LAN address, select sensors and Start. Devices register without pairing. Phone events, location, named regions and activity transitions are optional and require real Android permissions; activity needs installed Google Play services. Disable a device to reject reports. See android/README.md for setup, privacy, Task conditions and building.

Starts disabled with fresh default settings, no cached readings, saved Cards or Controls. Configure through the shared administrator; do not copy credentials from someone else's installation.

## Settings

- **Minimum report interval (ms)**: Android honors this server minimum. Latest raw values are sent; intermediate samples are not archived.. Choices: 250, 500, 1000, 2000, 5000, 10000, 30000, 60000.
- **Minimum interval per sensor Event (seconds)**: number.
- **Maximum sensor Events per report**: One-shot and special-trigger sensors have priority; each group rotates fairly. Current readings are stored even when Event delivery is limited..
- **No-recent-reports timeout (seconds)**: Uses server reception time, not the phone clock. Set longer than the report interval..
- **Connection check interval**: number. Choices: 5 seconds, 10 seconds, 15 seconds, 30 seconds.
- **Devices**: Trusted LAN devices register automatically. Disable a device to reject its reports. Names are editable; IDs identify app installations..
  - **Device ID**: string
  - **Name**: string
  - **Enabled**: boolean

## Actions and events

Actions: Check sensor connections.

Events: Battery; Screen; Unlocked; Network; Bluetooth; Audio device; Phone call; Notification; Media playback; Foreground app; NFC tag; Manual button; Location; Region entered; Region left; Activity entered; Activity left; Accelerometer; Magnetic field; Orientation (legacy); Gyroscope; Light; Pressure; Temperature (legacy); Proximity; Gravity; Linear acceleration; Rotation vector; Relative humidity; Ambient temperature; Uncalibrated magnetic field; Game rotation vector; Uncalibrated gyroscope; Significant motion; Step detector; Step counter; Geomagnetic rotation vector; Heart rate; Tilt detector; Wake gesture; Glance gesture; Pick-up gesture; Wrist tilt gesture; Device orientation; Pose 6DOF; Stationary detection; Motion detection; Heart beat; Dynamic sensor metadata; Low latency off-body detection; Uncalibrated accelerometer; Hinge angle; Head tracker; Limited-axis accelerometer; Limited-axis gyroscope; Limited-axis uncalibrated accelerometer; Limited-axis uncalibrated gyroscope; Heading; Other sensor; Reports resumed; No recent reports.

Plugin actions appear in global Tasks only when the plugin is enabled and ready. Explicit device actions can have real effects. Polling failures retain successful same-target readings; missing values remain explicit and uncertain effects are not automatically retried/replayed.

## Cards

Ready-made designs: Sensorium, Sensorium · Fullscreen. Designs are package assets, not preconfigured saved Cards. Create a Card, choose its source and enable it before adding it to a Vista. Cards and Vistas are read-only; Controls/Tasks own actions.

See [installation instructions](../../INSTALL.md) for storage, credentials and LAN access. Private mutable files are created only under this plugin's data folder.
