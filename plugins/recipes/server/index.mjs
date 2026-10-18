/** Readiness only: Recipes has no provider, polling, events or device actions. */
export default {
  validateConfiguration(){return true;},
  async start(){},
  async stop(){},
  async execute(){throw Error('Recipes creates drafts in the administrator; it exposes no executable actions.');},
};
