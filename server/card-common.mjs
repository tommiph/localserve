/** Shared typed public Card metadata, independent of plugin credentials. */
export const commonFields = [
  { id: 'plugin-name', label: 'Plugin name', type: 'string', icon: 'plug' },
  { id: 'plugin-version', label: 'Plugin version', type: 'string', icon: 'code' },
  { id: 'plugin-status', label: 'Plugin status', type: 'string', icon: 'circle-check' },
  { id: 'plugin-health', label: 'Runtime health', type: 'string', icon: 'heart' },
  { id: 'plugin-enabled', label: 'Plugin enabled', type: 'boolean', icon: 'toggle-on' },
  { id: 'plugin-configured', label: 'Configuration complete', type: 'boolean', icon: 'sliders' },
  { id: 'last-message', label: 'Latest log message', type: 'string', icon: 'comment' },
  { id: 'last-log-level', label: 'Latest log level', type: 'string', icon: 'clipboard-list' },
  { id: 'last-activity', label: 'Last activity time', type: 'timestamp', icon: 'clock' },
  { id: 'recent-log', label: 'Recent log entries', type: 'log', icon: 'clipboard-list' },
];
