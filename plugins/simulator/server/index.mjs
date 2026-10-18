/** Simulator implements Localserve's supervised plugin runtime contract.
 * Its effects are local file writes and explicit events; it never accesses devices.
 */
export default {
  validateConfiguration(settings) {
    return settings['configuration-complete'] === true;
  },

  async start() {},
  async stop() {},

  async execute(actionId, parameters, context) {
    context.signal.throwIfAborted();
    if (actionId === 'log') {
      await context.log(parameters.message, parameters.level);
    } else if (actionId === 'set-value') {
      const state = await context.readState();
      const previous = state.value;
      if (previous === parameters.value) return { changed: false };
      // Commit before reporting the event. A crash between these operations may
      // lose an occurrence; restart never replays events or repeats saved effects.
      state.value = parameters.value;
      await context.saveState(state);
      await context.emit('value-changed', previous === undefined ? { value: state.value } : { value: state.value, previous });
      return { changed: true };
    } else if (actionId === 'emit-signal') {
      return context.emit('signal', { message: parameters.message });
    } else if (actionId === 'pulse') {
      const state = await context.readState();
      state.sequence = (state.sequence || 0) + 1;
      await context.saveState(state);
      return context.emit('pulse', { sequence: state.sequence });
    } else if (actionId === 'wait') {
      await context.log(`Wait: ${parameters.seconds} seconds`);
      await context.wait(parameters.seconds);
      await context.log('Wait completed', 'success');
    } else if (actionId === 'fail') {
      await context.log(parameters.message, 'warning');
      throw new Error(parameters.message);
    } else throw new Error('Unknown Simulator action.');
    return { completed: true };
  },
};
