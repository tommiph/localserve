/** Sequential Task execution. Delays are asynchronous and pause cooperatively.
 * Schedule claims are persisted before dispatch to avoid duplicate starts.
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { doNotDisturbStatus, isTvAction, tvDoNotDisturbError } from './do-not-disturb.mjs';
import { performance } from 'node:perf_hooks';
import { HttpError } from './storage.mjs';
import { validateRule, reconcileRuleClocks, solarOccurrence, ruleTypes,
  eventConditionSignature, eventConditionMatches, reconcileEventConditions } from './rules.mjs';
import { validateValues } from './plugin-schema.mjs';
import { validateTaskParameters, resolveTaskParameters } from './task-event-values.mjs';

const activityAction = {
  id: 'log', type: 'log', category: 'server', name: 'Log activity',
  description: 'Write a message to Activity.', defaults: {message: ''}, available: true,
  parameters: [{id: 'message', label: 'Message', type: 'string', required: true, maxLength: 2000, format: 'multiline'}],
};
export const builtInActions = [
  activityAction,
  { id: 'delay', type: 'delay', category: 'server', name: 'Delay', description: 'Wait before the next step.', defaults: { seconds: 5 }, available: true },
  { id: 'show-vista', type: 'show-vista', category: 'server', name: 'Show Vista', icon: 'display', description: 'Change the Vista on the shared end-user /display page.', defaults: { vistaId: '' }, available: true },
];

// Receipts contain identity/outcome/timing only, never action arguments. Large
// Tasks still execute fully; history explicitly reports omitted receipt rows.
const runReceiptLimit = 256;

export function validateTask(value, existing = null, actions = [], events = [], vistas = []) {
  // Build a new allowlisted definition rather than storing the request object.
  // Disabled blocks still need valid fields so enabling them later is safe.
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 64) throw new HttpError(400, 'Enter a Task name between 1 and 64 characters.');
  if (typeof value.enabled !== 'boolean' || !Array.isArray(value.starts) || !Array.isArray(value.steps) || !value.steps.length) throw new HttpError(400, 'A Task needs an Enabled state and at least one step.');
  const ids = new Set();
  // Starts and steps share one identifier space within their parent Task.
  const checkId = item => {
    if (typeof item.id !== 'string' || item.id.length > 80 || !item.id || ids.has(item.id)) throw new HttpError(400, 'Block identifiers must be unique.');
    if (typeof item.enabled !== 'boolean') throw new HttpError(400, 'Each block needs an Enabled state.');
    ids.add(item.id);
  };
  const starts = value.starts.map(start => {
    checkId(start);
    if (start.type === 'event' && !events.some(event => event.id === start.eventId)) {
      const previous = existing?.starts.find(rule => rule.id === start.id && rule.type === 'event' && rule.eventId === start.eventId);
      // Preserve a saved missing source during unrelated edits; new Event rules
      // still require a declaration. A missing source cannot produce occurrences.
      if (previous) {
        if (JSON.stringify(previous.condition) !== JSON.stringify(start.condition)) {
          throw new HttpError(400, 'The unavailable event condition must remain unchanged.');
        }
        const rule = validateRule({ ...start, condition: undefined }, [{ id: previous.eventId }]);
        if (previous.condition) rule.condition = structuredClone(previous.condition);
        return rule;
      }
    }
    return validateRule(start, events);
  });
  const steps = value.steps.map(step => {
    checkId(step);
    const common = { id: step.id, type: step.type, enabled: step.enabled };
    if (step.type === 'log') {
      const previous = existing?.steps.find(item => item.id === step.id && item.type === 'log');
      const values = validateTaskParameters(activityAction, {message: step.message}, starts, events,
        previous ? {message: previous.message} : null);
      return { ...common, message: values.message.trim() };
    }
    if (step.type === 'delay') {
      if (!Number.isFinite(step.seconds) || step.seconds <= 0 || step.seconds > 86400) throw new HttpError(400, 'Delay must be greater than zero and at most 86400 seconds.');
      return { ...common, seconds: step.seconds };
    }
    if (step.type === 'show-vista') {
      const previous = existing?.steps.find(item => item.id === step.id && item.type === 'show-vista' && item.vistaId === step.vistaId);
      if (typeof step.vistaId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(step.vistaId)
        || !vistas.some(vista => vista.id === step.vistaId) && !previous) {
        throw new HttpError(400, 'Choose a saved Vista.');
      }
      return { ...common, vistaId: step.vistaId };
    }
    if (step.type === 'plugin') {
      // Keep definitions editable when a producer is disabled; execution checks
      // live readiness separately at admission and again at each plugin step.
      const action = actions.find(action => action.id === step.capabilityId);
      if (!action) {
        const previous = existing?.steps.find(item => item.id === step.id && item.type === 'plugin' && item.capabilityId === step.capabilityId);
        // An unrelated edit can retain a missing dependency, but cannot introduce
        // or change opaque parameters whose declaration is no longer available.
        if (!previous || JSON.stringify(previous.parameters) !== JSON.stringify(step.parameters)) throw new HttpError(400, 'This plugin capability is unavailable.');
        return { ...common, capabilityId: previous.capabilityId, parameters: structuredClone(previous.parameters) };
      }
      const previous = existing?.steps.find(item => item.id === step.id && item.capabilityId === step.capabilityId);
      const parameters = validateTaskParameters(action, step.parameters || {}, starts, events, previous?.parameters);
      return { ...common, capabilityId: action.id, parameters };
    }
    throw new HttpError(400, 'Choose a server action or a declared plugin action.');
  });
  return { id: existing?.id || randomUUID(), revision: (existing?.revision || 0) + 1,
    name: value.name.trim(), enabled: value.enabled, starts, steps };
}

/** Shared pause gate. Each run retains its own cancellation signal.
 * Pause is cooperative: it suspends work at a step boundary or inside Delay.
 * It cannot undo a completed action or interrupt an arbitrary device command.
 */
export class ExecutionGate extends EventEmitter {
  constructor(paused = false) {
    super();
    this.paused = paused;
    // Several active runs may legitimately wait on the same pause gate.
    this.setMaxListeners(0);
  }
  setPaused(value) {
    this.paused = value;
    this.emit('change');
  }
  async wait(signal) {
    // Recheck after every notification; a change does not itself mean resume.
    while (this.paused) await this.changed(signal);
    signal.throwIfAborted();
  }
  changed(signal, milliseconds = null) {
    signal.throwIfAborted();
    // Resume/pause, cancellation, and an optional timeout share one waiter.
    // Whichever finishes first removes every listener and the timer so runs
    // cannot accumulate stale listeners while repeatedly pausing or delaying.
    return new Promise((resolve, reject) => {
      let timer;
      const clean = () => {
        clearTimeout(timer);
        this.off('change', finish);
        signal.removeEventListener('abort', abort);
      };
      const finish = () => {
        clean();
        resolve();
      };
      const abort = () => {
        clean();
        reject(signal.reason || new Error('Cancelled'));
      };
      this.once('change', finish);
      signal.addEventListener('abort', abort, { once: true });
      if (milliseconds !== null) timer = setTimeout(finish, milliseconds);
    });
  }
  async delay(milliseconds, signal) {
    // Count only elapsed running time. A monotonic clock avoids changes to the
    // system clock; waiting at the pause gate does not consume the remainder.
    let remaining = milliseconds;
    while (remaining > 0) {
      await this.wait(signal);
      const before = performance.now();
      await this.changed(signal, remaining);
      remaining -= performance.now() - before;
    }
    // Pause or cancellation at the timeout boundary must also block the next step.
    await this.wait(signal);
  }
}

export function scheduleMinute(date) {
  // Omit timeZone so Intl uses the server process's system timezone automatically.
  // Seconds are intentionally omitted: schedules have minute precision.
  const parts = new Intl.DateTimeFormat('en', { year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}`,
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday) };
}

export class TaskEngine {
  constructor(tasks, state, config, registry, activity) {
    Object.assign(this, { tasks, state, config, registry, activity });
    this.gate = new ExecutionGate(state.snapshot().paused);
    this.active = new Map();
    this.pending = new Set();
    this.scheduling = false;
  }
  async recover() {
    // Persisted records are history, not a restart queue. Replaying a partially
    // completed run could repeat actions whose effects already occurred.
    await this.state.update(state => {
      for (const run of state.runs) if (['running', 'queued'].includes(run.status)) {
        run.status = 'interrupted';
        run.finishedAt = Date.now();
        for (const step of run.steps || []) if (step.status === 'running') {
          step.status = 'interrupted'; step.finishedAt = run.finishedAt;
        }
        for (const step of run.steps || []) if (step.status === 'pending') {
          step.status = 'not-run'; step.reason = 'Server stopped before this step';
        }
      }
    });
    await this.syncRuleClocks();
  }
  async syncRuleClocks(date = new Date()) {
    const previous = this.state.snapshot().ruleClocks || {};
    const next = reconcileRuleClocks(this.tasks.snapshot(), previous, date.getTime());
    const previousConditions = this.state.snapshot().eventConditions || {};
    const nextConditions = reconcileEventConditions(this.tasks.snapshot(), previousConditions);
    // Normal scheduler ticks do not rewrite unchanged clocks every half second.
    if (JSON.stringify(previous) === JSON.stringify(next)
      && JSON.stringify(previousConditions) === JSON.stringify(nextConditions)) return;
    await this.state.update(state => {
      state.ruleClocks = reconcileRuleClocks(this.tasks.snapshot(), state.ruleClocks, date.getTime());
      state.eventConditions = reconcileEventConditions(this.tasks.snapshot(), state.eventConditions);
    });
  }
  capturedEvent(run, task) {
    if (!run.event) return null;
    if (!run.event.payload || typeof run.event.payload !== 'object' || Array.isArray(run.event.payload)
      || run.event.trace !== undefined && (!Array.isArray(run.event.trace) || run.event.trace.length > 8
        || run.event.trace.some(item => typeof item !== 'string' || item.length > 200))) {
      throw new HttpError(409, 'The saved Event values are unavailable.');
    }
    const source = this.registry.events().find(item => item.pluginId === run.event.pluginId && item.eventId === run.event.eventId
      && (!item.instanceId || run.event.payload?.[item.instanceKey] === item.instanceId)
      && (!item.sensorId || run.event.payload?.['sensor-id'] === item.sensorId));
    if (!source || !task.starts.some(rule => rule.type === 'event' && rule.eventId === source.id)) {
      throw new HttpError(409, 'This Task needs a matching declared Event rule to use these saved values.');
    }
    // Reuse only server-owned history and the current public schema. Removed,
    // private or newly invalid fields cannot be reintroduced by a manual run.
    const fields = source.payload.filter(field => field.format !== 'secret' && ['string', 'number', 'boolean'].includes(field.type));
    const payload = Object.fromEntries(fields.filter(field => Object.hasOwn(run.event.payload, field.id))
      .map(field => [field.id, run.event.payload[field.id]]));
    // New declaration defaults are not observations from the historical Event.
    // In particular, they must not fill a value that a bound step is missing.
    return {pluginId: source.pluginId, eventId: source.eventId, payload: validateValues(fields, payload),
      ...(Number.isFinite(run.event.occurredAt) ? {occurredAt: run.event.occurredAt} : {}),
      trace: run.event.trace || []};
  }
  historyRun(id) {
    const run = this.state.snapshot().runs.find(run => run.id === id);
    if (!run) throw new HttpError(404, 'Task run is no longer in history.');
    if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(run.status)) throw new HttpError(409, 'Wait for this run to finish or cancel it first.');
    return run;
  }
  manualStart(id, {revision, eventRunId} = {}) {
    const task = this.tasks.snapshot().find(task => task.id === id);
    if (!task) throw new HttpError(404, 'Task not found.');
    const source = eventRunId ? this.historyRun(eventRunId) : null;
    if (source && !source.event) throw new HttpError(409, 'This run has no saved Event values.');
    return this.start(id, source ? 'Manual · saved Event' : 'Manual', source ? this.capturedEvent(source, task) : null,
      {revision, ...(source ? {eventRunId: source.id} : {})});
  }
  rerun(id, {revision} = {}) {
    const source = this.historyRun(id);
    const task = this.tasks.snapshot().find(task => task.id === source.taskId);
    if (!task) throw new HttpError(404, 'The original Task has been deleted.');
    // This is a new explicit admission from step one, never an automatic retry
    // or a continuation of partly completed effects. Use the current definition.
    return this.start(task.id, 'Manual rerun', this.capturedEvent(source, task), {revision, rerunOf: source.id});
  }
  previewRerun(id, {revision} = {}) {
    const source = this.historyRun(id);
    const task = this.tasks.snapshot().find(task => task.id === source.taskId);
    if (!task) throw new HttpError(404, 'The original Task has been deleted.');
    const event = this.capturedEvent(source, task);
    this.assertStart(task, event, revision);
    const actions = this.registry.actions();
    const declaration = event && this.registry.events().find(item => item.pluginId === event.pluginId && item.eventId === event.eventId
      && (!item.instanceId || event.payload?.[item.instanceKey] === item.instanceId)
      && (!item.sensorId || event.payload?.['sensor-id'] === item.sensorId));
    const fields = declaration?.payload.filter(field => field.format !== 'secret' && ['string', 'number', 'boolean'].includes(field.type)) || [];
    // Preview is a projection of the current validated definition and retained
    // public Event. It reserves no run and writes no history or automatic claims.
    const steps = task.steps.slice(0, runReceiptLimit).map((step, index) => {
      const action = step.type === 'plugin' ? actions.find(action => action.id === step.capabilityId)
        : builtInActions.find(action => action.type === step.type);
      let parameters = [];
      if (step.enabled && (step.type === 'plugin' || step.type === 'log')) {
        const resolved = resolveTaskParameters(action, step.type === 'log' ? {message: step.message} : step.parameters, event, this.registry.events());
        parameters = action.parameters.filter(field => field.format !== 'secret' && ['string', 'number', 'boolean'].includes(field.type)
          && Object.hasOwn(resolved, field.id)).map(field => ({id: field.id, label: field.label || field.id, value: resolved[field.id]}));
      } else if (step.enabled && step.type === 'delay') parameters = [{id:'seconds',label:'Seconds',value:step.seconds}];
      else if (step.enabled && step.type === 'show-vista') parameters = [{id:'vista',label:'Vista',value:this.vistas.snapshot().find(vista=>vista.id===step.vistaId)?.name || 'Unavailable Vista'}];
      return {number:index + 1, label:action?.name || 'Unavailable action', enabled:step.enabled, parameters};
    });
    return {taskId:task.id, taskName:task.name, revision:task.revision, sourceRunId:source.id, sourceTaskRevision:source.taskRevision ?? null,
      stepCount:task.steps.length, steps, manualTvEffects:task.steps.some(step => {
        const action = step.enabled && step.type === 'plugin' && actions.find(action => action.id === step.capabilityId);
        return action && isTvAction(action.pluginId, action.actionId);
      }),
      event:event ? {name:declaration?.name || 'Event', pluginName:declaration?.pluginName || event.pluginId,
        occurredAt:event.occurredAt ?? null, values:fields.filter(field=>Object.hasOwn(event.payload,field.id)).map(field=>({id:field.id,label:field.label || field.id,value:event.payload[field.id]}))} : null};
  }

  assertStart(task, eventContext, revision) {
    if (this.closing) throw new HttpError(503, 'Server is stopping.');
    if (!task) throw new HttpError(404, 'Task not found.');
    if (revision !== undefined && revision !== task.revision) throw new HttpError(409, 'This Task changed. Refresh before running it.');
    if (this.gate.paused) throw new HttpError(409, 'Server is paused.');
    if (!task.enabled) throw new HttpError(409, 'Task is disabled.');
    for (const step of task.steps.filter(step => step.enabled && step.type === 'log')) {
      resolveTaskParameters(activityAction, {message: step.message}, eventContext, this.registry.events());
    }
    for (const step of task.steps.filter(step => step.enabled && step.type === 'show-vista')) {
      if (!this.vistas?.snapshot().some(vista => vista.id === step.vistaId && vista.enabled)) throw new HttpError(409, 'A Task step needs an enabled Vista.');
    }
    for (const step of task.steps.filter(step => step.enabled && step.type === 'plugin')) {
      const action = this.registry.actions().find(action => action.id === step.capabilityId && action.available);
      if (!action) throw new HttpError(409, 'A Task step needs an available plugin.');
      const parameters = resolveTaskParameters(action, step.parameters, eventContext, this.registry.events());
      this.registry.assertTaskTarget?.(action, parameters);
    }
    if (this.pending.has(task.id) || [...this.active.values()].some(run => run.taskId === task.id)) throw new HttpError(409, 'This Task is already running.');
    if (this.pending.size + this.active.size >= this.config.snapshot().maxConcurrentRuns) throw new HttpError(409, 'The server has reached its concurrent Task limit.');
  }
  async start(id, reason = 'Manual', eventContext = null, {revision, rerunOf, eventRunId, automatic = false} = {}) {
    // Capture before the first await: delays and later emissions must never
    // change which upload this run launches. Manual Event values come only from
    // an explicitly selected server-owned history entry.
    eventContext = eventContext ? structuredClone(eventContext) : null;
    if (eventContext) {
      Object.freeze(eventContext.payload);
      if (eventContext.trace) Object.freeze(eventContext.trace);
      Object.freeze(eventContext);
    }
    const task = this.tasks.snapshot().find(task => task.id === id);
    // Preview and admission share preflight; admission repeats it immediately
    // before reserving work. A preview never authorizes a later stale definition.
    this.assertStart(task, eventContext, revision);
    // Reserve admission before the first await. Other start requests must count
    // runs whose history write is pending as well as runs already executing.
    this.pending.add(id);
    const run = { id: randomUUID(), taskId: id, name: task.name, reason, status: 'running', startedAt: Date.now(), step: 0,
      stepCount: task.steps.length,
      steps: task.steps.slice(0, runReceiptLimit).map((step, index) => ({
        id: step.id, number: index + 1, type: step.type, enabled: step.enabled, status: 'pending',
        ...(step.type === 'plugin' ? {capabilityId:step.capabilityId} : {}),
        label: step.type === 'plugin' ? this.registry.actions().find(action => action.id === step.capabilityId)?.name || 'Unavailable action'
          : builtInActions.find(action => action.type === step.type)?.name || step.type,
      })),
      taskRevision: task.revision, automatic, ...(rerunOf ? {rerunOf} : {}), ...(eventRunId ? {eventRunId} : {}),
      ...(eventContext ? { event: eventContext } : {}) };
    const controller = new AbortController();
    try {
      // Record the run before executing any step. A failed write starts no work.
      await this.state.update(state => {
        state.runs.unshift(run);
        state.runs = state.runs.slice(0, 200);
      });
      // Pause, shutdown, deletion, or disabling may have occurred during the write.
      if (this.closing || this.gate.paused || !this.tasks.snapshot().find(item => item.id === id)?.enabled) controller.abort(new Error('Task is no longer runnable'));
      this.active.set(run.id, { ...run, controller });
    } finally {
      this.pending.delete(id);
    }
    // HTTP returns once the run is admitted; execution proceeds asynchronously.
    // A saved snapshot fixes the running order even if the Task is later edited.
    this.execute(structuredClone(task), run, controller).catch(error => console.error('Task persistence failure:', error.message));
    return run;
  }
  async execute(task, run, controller) {
    // Link every entry to both the definition and this particular run so history
    // remains identifiable after a Task is renamed or deleted.
    const log = (message, level = 'info') => this.activity.add(message, { source: task.name, taskId: task.id, runId: run.id, level });
    let currentStep = -1;
    try {
      await log(`Task started: ${run.reason}`);
      for (let index = 0; index < task.steps.length; index += 1) {
        await this.gate.wait(controller.signal);
        const step = task.steps[index];
        currentStep = index;
        this.active.get(run.id).step = index + 1;
        if (!step.enabled) {
          await this.recordStep(run.id, index, {status: 'skipped', reason: 'Disabled', finishedAt: Date.now()});
          await log(`Step ${index + 1} skipped: Disabled`); currentStep = -1; continue;
        }
        // Persist execution intent before effects. Recheck pause/cancellation
        // after that await; receipt writes must never weaken those boundaries.
        await this.recordStep(run.id, index, {status: 'running', startedAt: Date.now()});
        await this.gate.wait(controller.signal);
        let skipped = false;
        if (step.type === 'log') await log(resolveTaskParameters(activityAction, {message: step.message}, run.event, this.registry.events()).message);
        else if (step.type === 'delay') {
          await log(`Step ${index + 1}: Delay ${step.seconds} second${step.seconds === 1 ? '' : 's'}`);
          await this.gate.delay(step.seconds * 1000, controller.signal);
        } else if (step.type === 'show-vista') {
          await this.vistas.show(step.vistaId, { signal: controller.signal, gate: this.gate });
          const vista = this.vistas.snapshot().find(vista => vista.id === step.vistaId);
          await log(`Step ${index + 1}: Show Vista · ${vista?.name || 'Unavailable Vista'}`);
        } else if (step.type === 'plugin') {
          const action = this.registry.actions().find(action => action.id === step.capabilityId);
          if (!action?.available) throw new Error('Plugin action is unavailable.');
          const parameters = resolveTaskParameters(action, step.parameters, run.event, this.registry.events());
          try {
            // Skip only TV effects, preserving other steps and already-consumed
            // rule claims. Recheck after delays; quiet hours never queue a replay.
            if (run.automatic && isTvAction(action.pluginId, action.actionId)
              && doNotDisturbStatus(this.config.snapshot().doNotDisturb).active) throw tvDoNotDisturbError();
            await this.registry.execute(action.pluginId, action.actionId, parameters, {
              signal: controller.signal, taskId: task.id, runId: run.id, stepId: step.id,
              automatic: run.automatic, trace: run.event?.trace || [],
            });
          } catch (error) {
            if (error.code !== 'TV_DO_NOT_DISTURB' || controller.signal.aborted) throw error;
            skipped = true;
            await log(`Step ${index + 1}: Do not disturb · Automatic TV action skipped or stopped; no retry`, 'warning');
          }
        } else throw new Error('Unknown Task step.');
        await this.recordStep(run.id, index, {status: skipped ? 'skipped' : 'completed', finishedAt: Date.now(), ...(skipped ? {reason: 'Do not disturb'} : {})});
        currentStep = -1;
      }
      await this.finish(run.id, 'completed');
      await log('Task completed', 'success');
    } catch (error) {
      const cancelled = controller.signal.aborted;
      if (currentStep >= 0) await this.recordStep(run.id, currentStep, {
        status: cancelled ? 'cancelled' : 'failed', finishedAt: Date.now(),
        reason: String(cancelled ? 'Cancelled' : error.message).slice(0, 1000),
      });
      await this.finish(run.id, cancelled ? 'cancelled' : 'failed', cancelled ? undefined : error.message);
      await log(cancelled ? 'Task cancelled' : `Task failed: ${error.message}`, cancelled ? 'info' : 'warning');
    } finally {
      this.active.delete(run.id);
    }
  }
  recordStep(id, index, values) {
    if (index >= runReceiptLimit) return Promise.resolve();
    return this.state.update(state => {
      const step = state.runs.find(run => run.id === id)?.steps?.[index];
      if (step) Object.assign(step, values);
    });
  }
  finish(id, status, error) {
    // History is bounded; a very old active run may no longer have a saved row.
    return this.state.update(state => {
      const run = state.runs.find(run => run.id === id);
      if (run) {
        Object.assign(run, { status, finishedAt: Date.now(), ...(error ? {error: String(error).slice(0, 1000)} : {}) });
        for (const step of run.steps || []) if (step.status === 'pending') {
          step.status = 'not-run'; step.reason = 'Run ended before this step';
        }
      }
    });
  }
  cancel(id) {
    const run = this.active.get(id);
    if (!run) throw new HttpError(404, 'Run is no longer active.');
    run.controller.abort(new Error('Cancelled'));
  }
  cancelTask(id) { for (const run of this.active.values()) if (run.taskId === id) run.controller.abort(new Error('Task disabled or deleted')); }
  async setPaused(paused) {
    // Commit the preference before changing the live gate; failed persistence
    // must leave the currently running server state unchanged.
    await this.state.update(state => { state.paused = paused; });
    this.gate.setPaused(paused);
    await this.activity.add(paused ? 'Server functions paused' : 'Server functions resumed');
  }
  async tick(date = new Date()) {
    // Timer callbacks may overlap while storage is awaiting disk writes.
    // One scheduling pass at a time avoids competing evaluations in memory.
    if (this.scheduling || this.gate.paused) return;
    this.scheduling = true;
    try {
      await this.syncRuleClocks(date);
      const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
      const minute = scheduleMinute(date);
      for (const task of this.tasks.snapshot().filter(task => task.enabled)) {
        for (const start of task.starts.filter(start => start.enabled)) {
          if (start.type === 'event') continue;
          if (['timer', 'interval'].includes(start.type)) {
            await this.tickClock(task, start, date);
            continue;
          }
          const occurrence = start.type === 'schedule' ? null : solarOccurrence(date, start, this.config.snapshot().location);
          const time = start.type === 'schedule' ? start.time
            : occurrence === null ? null : scheduleMinute(new Date(occurrence)).time;
          if (time !== minute.time || !start.days.includes(minute.day)) continue;
          // A local date/time key suppresses the repeated minute at a daylight-
          // saving fallback. Keep the derived system zone in the key so a system
          // zone change does not confuse occurrences from different calendars.
          const key = `${task.id}/${start.id}/${minute.date}/${minute.time}/${timezone}`;
          if (this.state.snapshot().claims.includes(key)) continue;
          const claimed = await this.state.update(state => {
            // Recheck inside the serialized write queue: earlier writes may have
            // claimed this minute or paused the server while we were waiting.
            if (state.claims.includes(key) || state.paused) return false;
            state.claims.push(key);
            state.claims = state.claims.slice(-2000);
            return true;
          });
          if (claimed) {
            // Consume the claim before dispatch. A crash or rejected start may
            // skip this occurrence; retrying it could repeat completed effects.
            // Claims are bounded, so deduplication applies to retained keys only.
            await this.dispatchRule(task, start);
          }
        }
      }
    } finally {
      this.scheduling = false;
    }
  }
  async dispatchRule(task, rule, eventContext = null) {
    // A rule may have been removed or changed while its claim was being saved.
    const current = this.tasks.snapshot().find(item => item.id === task.id);
    const activeRule = current?.starts.find(item => item.id === rule.id && item.enabled);
    if (!current?.enabled || JSON.stringify(activeRule) !== JSON.stringify(rule)) return;
    try { await this.start(task.id, `${ruleTypes[rule.type]}: ${rule.name}`, eventContext, {automatic: true}); }
    catch (error) {
      await this.activity.add(`Rule Task skipped: ${task.name}: ${error.message}`, { level: 'warning', taskId: task.id });
    }
  }
  async tickClock(task, rule, date) {
    const key = `${task.id}/${rule.id}`;
    const now = date.getTime();
    const clock = this.state.snapshot().ruleClocks?.[key];
    if (!clock || clock.signature !== `${rule.type}/${rule.seconds}` || clock.completed || clock.nextAt > now) return;
    const claimed = await this.state.update(state => {
      const current = state.ruleClocks?.[key];
      if (state.paused || !current || current.generation !== clock.generation
        || current.completed || current.nextAt > now) return false;
      // Persist consumption before dispatch. Restart cannot repeat a Timer;
      // overdue Intervals coalesce into one attempt rather than a burst of runs.
      if (rule.type === 'timer') current.completed = true;
      else current.nextAt += (Math.floor((now - current.nextAt) / (rule.seconds * 1000)) + 1) * rule.seconds * 1000;
      return true;
    });
    if (claimed) await this.dispatchRule(task, rule);
  }
  async emitPluginEvent(pluginId, eventId, payload = {}, context = {}) {
    // Only declared, ready producers dispatch. Payloads are validated here as
    // well as at the worker boundary; no arbitrary HTTP event injection exists.
    // Sensor Events can arrive frequently; checking their producer must not
    // rebuild every plugin's Card projection for each individual raw sample.
    const sensorRecord=pluginId==='sensors'?this.registry.records?.get(pluginId):null;
    const plugin = sensorRecord ? {enabled:sensorRecord.config.snapshot().enabled,configurationReady:sensorRecord.configured && sensorRecord.health==='ready'}
      : this.registry.services().find(plugin => plugin.id === pluginId);
    const capability = this.registry.events().find(event => event.pluginId === pluginId && event.eventId === eventId
      && (!event.instanceId || event.instanceEnabled && payload[event.instanceKey] === event.instanceId)
      && (!event.sensorId || payload['sensor-id'] === event.sensorId));
    if (!plugin?.enabled || !plugin.configurationReady || !capability) {
      throw new HttpError(409, 'Plugin event source is unavailable.');
    }
    const validated = validateValues(capability.payload || [], payload, true);
    if (this.closing || this.gate.paused) return { delivered: false, reason: 'paused-or-stopping' };
    const trace = context.trace || [];
    // Carry causal ancestry through asynchronously started Tasks. A simple rate
    // limit alone would still permit an endless alternating event/action loop.
    if (trace.length >= 8) {
      await this.activity.add('Plugin event chain stopped at 8 generations', { level: 'warning', pluginId, eventId });
      return { delivered: false, reason: 'chain-limit' };
    }
    const event = { pluginId, eventId, payload: validated, occurredAt: Date.now(), trace: [...trace, `${pluginId}:${eventId}`] };
    for (const task of this.tasks.snapshot().filter(task => task.enabled)) {
      for (const rule of task.starts.filter(rule => rule.enabled && rule.type === 'event' && rule.eventId === capability.id)) {
        if (rule.condition && !(await this.claimEventCondition(task, rule, validated, capability.occurrenceKey))) continue;
        await this.dispatchRule(task, rule, event);
      }
    }
    return { delivered: true };
  }

  async claimEventCondition(task, rule, payload, occurrenceKey) {
    const matched = eventConditionMatches(rule.condition, payload);
    if (matched === null) return false;
    return this.state.update(state => {
      const currentTask = this.tasks.snapshot().find(item => item.id === task.id);
      const currentRule = currentTask?.starts.find(item => item.id === rule.id);
      if (state.paused || this.closing || !currentTask?.enabled || !currentRule?.enabled
        || JSON.stringify(currentRule) !== JSON.stringify(rule)) return false;
      state.eventConditions = reconcileEventConditions(this.tasks.snapshot(), state.eventConditions);
      const key = `${task.id}/${rule.id}`;
      const previous = state.eventConditions[key];
      const occurrence = occurrenceKey ? payload[occurrenceKey] : undefined;
      const entered = matched && (previous.matched !== true
        || occurrenceKey && previous.occurrence !== occurrence);
      // Persist the transition before Task admission. Concurrent producers cannot
      // claim the same true edge twice. A skipped/crashed admission consumes the
      // edge; retry/replay could repeat effects. False readings rearm the rule.
      // Discrete producers supply a durable movement identity. Consecutive K
      // trains are separate conditions even when no intervening non-K train is
      // observed. The producer claims identities before emitting; this server
      // claim still precedes admission and suppresses a repeated current edge.
      state.eventConditions[key] = { signature: eventConditionSignature(rule), matched,
        ...(occurrenceKey ? { occurrence } : {}) };
      return entered;
    });
  }
  async close() {
    this.closing = true;
    // Pending admissions may become active during shutdown. Keep cancelling
    // until they and the scheduler have drained their history/log writes.
    while (this.active.size || this.pending.size || this.scheduling) {
      for (const run of this.active.values()) run.controller.abort(new Error('Server stopping'));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
