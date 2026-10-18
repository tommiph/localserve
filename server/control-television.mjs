/** Presentation hints only. Fixed arguments and app IDs remain private; the
 * viewer can still invoke only the original saved item through shared claims. */
export function televisionRole(item) {
  if (item.kind === 'scene') return 'scene';
  if (item.steps.length !== 1) return 'other';
  const step = item.steps[0];
  if (item.kind === 'range' && step.actionId === 'volume' && item.parameter === 'value') return 'volume';
  if (item.kind === 'toggle' && step.actionId === 'mute' && item.parameter === 'muted') return 'muted';
  if (item.kind === 'select' && step.actionId === 'input' && item.parameter === 'input') return 'input';
  if (item.kind !== 'button') return 'other';
  const actions = { 'power-off':'off', wake:'wake', 'launch-app':'app', play:'play', pause:'pause', stop:'stop', refresh:'refresh', 'refresh-apps':'refresh-apps' };
  if (actions[step.actionId]) return actions[step.actionId];
  if (step.actionId !== 'key') return 'other';
  // Keep toggle and explicit Off distinct: presentation must describe the saved
  // command, and must never send a second key as a firmware fallback.
  if (step.parameters.key === 'KEY_POWER') return 'power';
  if (step.parameters.key === 'KEY_POWEROFF') return 'off';
  const keys = { KEY_UP:'up',KEY_DOWN:'down',KEY_LEFT:'left',KEY_RIGHT:'right',KEY_ENTER:'enter',KEY_HOME:'home',KEY_RETURN:'back',KEY_MENU:'menu',KEY_EXIT:'exit',KEY_SOURCE:'source',KEY_VOLUP:'volume-up',KEY_VOLDOWN:'volume-down',KEY_MUTE:'mute',KEY_CHUP:'channel-up',KEY_CHDOWN:'channel-down',KEY_INFO:'info',KEY_GUIDE:'guide',KEY_PLAY:'play',KEY_PAUSE:'pause',KEY_STOP:'stop',KEY_REWIND:'rewind',KEY_FF:'forward' };
  return keys[step.parameters.key] || 'other';
}
