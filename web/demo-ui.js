/** Optional first-use examples are persisted by the server, never browser data. */
const DemoUI={
  busy:false,
  render(){
    const demo=state.demo;
    if(!demo||!demo.available&&demo.status!=='ready'&&demo.status!=='installing')return '';
    if(demo.status==='ready'&&!demo.taskId&&!demo.vistaUrl)return '';
    const ready=demo.status==='ready';
    return `<section class="panel demo-start" data-live-key="demo-onboarding" aria-label="Localserve demo">
      <div class="demo-art" aria-hidden="true"><img src="/plugin-card-assets/simulator/signal-lab/assets/motif.svg" alt=""></div>
      <div class="demo-copy"><span class="demo-eyebrow">${ready?'Simulator demo':'Start here'}</span>
      <h2>${ready?'See your Task change a screen':'Try Localserve without a device'}</h2>
      <p>${ready?'Open the demo screen, then run the Task. Watch the value, pulse count and message change. Everything is editable in Tasks, Cards and Vistas.':'Create a Task, a Signal lab Card and a finished Vista. Only Simulator is enabled. No devices, accounts or external services are used.'}</p>
      <div class="demo-buttons">${ready?
        `${demo.vistaUrl?`<a class="button primary" href="${escapeHtml(demo.vistaUrl)}" target="_blank" rel="noopener">${icon('display')}Open demo screen</a>`:''}
        <button class="button" data-action="demo-run" ${!demo.canRun||this.busy?'disabled':''}>${icon('play')}${demo.running?'Demo Task running…':'Run demo Task'}</button>
        ${demo.taskId?`<button class="text-button" data-action="edit-task" data-id="${escapeHtml(demo.taskId)}">Edit Task</button>`:''}`:
        `<button class="button primary" data-action="demo-install" ${!demo.available||this.busy?'disabled':''}>${icon('play')}${demo.status==='installing'?'Finish demo setup':'Create demo'}</button><span class="demo-choice">Optional · Your installation can stay empty</span>`}
      </div><p class="demo-feedback" role="status" aria-live="polite">${this.busy?'Please wait…':''}</p></div></section>`;
  },
  async handle(action){
    if(this.busy)return;
    this.busy=true;renderView();
    try{
      if(action==='demo-install'){await mutate('api/demo/install',{});notify('Demo created. Open its screen, then run the Task.');}
      else if(action==='demo-run'){await mutate('api/demo/run',{revision:state.demo.revision});notify('Demo Task started.');}
    }finally{this.busy=false;renderView();}
  },
};
