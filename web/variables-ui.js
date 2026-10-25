/** Administrator-only schema reference. Never inspect live payloads, settings,
 * private state or captured values. Rebuild from each normal server snapshot so
 * discovery, named sources and physical sensor capabilities stay up to date. */
const VariablesUI = {
  search: '', owner: '', kind: '', limit: 100, opened: new Set(), helpOpen: false,
  scalar(field) { return field.format !== 'secret' && ['string','number','boolean'].includes(field.type); },

  records(snapshot = state) {
    const rows = [];
    const add = (owner, ownerName, kind, context, label, code, type, help, file, example) =>
      rows.push({owner, ownerName, kind, context, label, code, type, help, file, example});
    const services = snapshot.services || [], events = snapshot.taskEvents || [];
    add('server','Server','rule','Task rule combination','AND / OR','ruleMode','string',
      'Task ruleMode is or (default) or and. AND combines latest reported Event comparisons; time rules must fall due together. Event tags still come only from the triggering report.',
      'data/tasks.json; server/task-rule-groups.mjs',{ruleMode:'and'});
    for (const [id, name] of Object.entries(TaskUI.ruleTypes)) {
      add('server','Server','rule','Task start rule',name,id,'rule',
        'Use starts[].type. Only Event rules supply captured Event values.', 'data/tasks.json', {type:id});
    }
    for (const action of snapshot.taskActions || []) {
      const service = services.find(service => service.id === action.pluginId);
      const owner = service?.id || 'server', ownerName = service?.name || 'Server';
      const file = service ? `plugins/${service.folder || service.id}/declaration.json → actions[]; data/tasks.json → steps[]` : 'server/tasks.mjs; data/tasks.json → steps[]';
      const parameters = (action.parameters || []).filter(field => field.format !== 'secret');
      const bindable = parameters.filter(field => this.scalar(field) && field.type === 'string' && !field.enum);
      add(owner,ownerName,'action','Task action',action.name,action.id,'action',
        `${action.description || ''} ${bindable.length ? 'Event text can be inserted in: ' + bindable.map(field => field.id).join(', ') + '.' : 'No Event text substitution parameter.'} ${action.available === false ? action.unavailableReason || 'Currently unavailable.' : ''}`,
        file, service ? {type:'plugin',capabilityId:action.id,parameters:{}} : {type:action.type,...action.defaults});
      for (const field of parameters) add(owner,ownerName,'parameter',action.name,field.label || field.id,field.id,field.type,
        `${field.required ? 'Required' : 'Optional'}. ${field.enum ? 'Choices: ' + field.enum.map((value,index) => field.enumLabels?.[index] ? field.enumLabels[index] + ' (' + value + ')' : value).join(', ') + '.' : ''} ${field.type === 'string' && !field.enum ? 'Accepts declared {{event.field-id}} values.' : 'Use a literal typed value.'} ${field.description || ''}`,
        file, {parameters:{[field.id]:field.default ?? field.enum?.[0] ?? (field.type === 'string' ? '<text>' : field.type === 'boolean' ? false : field.type === 'list' ? [] : field.min ?? 0)}});
    }
    for (const service of services) {
      const folder = `plugins/${service.folder || service.id}`;
      const ownEvents = events.filter(event => event.pluginId === service.id);
      // Unconfigured source-based declarations still document their fields.
      // Their declaration ID must never masquerade as a selectable rule ID.
      const sources = [...ownEvents, ...(service.events || []).filter(event => !ownEvents.some(source => source.eventId === event.id))
        .map(event => ({...event, declaredOnly:true}))];
      for (const event of sources) {
        const scope = `${event.name} · ${event.declaredOnly ? 'Declaration; add a source for its rule ID' : event.id}`;
        for (const field of (event.payload || []).filter(field => this.scalar(field))) {
          const token = `{{event.${field.id}}}`;
          add(service.id,service.name,'event',scope,field.label || field.id,token,field.type,
            `${field.required ? 'Required payload field' : 'Optional; absence stops a bound run'}. ${field.unit ? 'Unit: ' + field.unit + '.' : ''} ${service.enabled === false ? 'Plugin disabled.' : ''} ${event.instanceEnabled === false ? 'Source disabled.' : ''} Select the matching Event rule; not a latest-state lookup.`,
            `${folder}/declaration.json → events[].payload; data/tasks.json → steps[]`,
            event.declaredOnly ? {steps:[{type:'log',message:token}]} : {starts:[{type:'event',eventId:event.id}],steps:[{type:'log',message:token}]});
        }
      }
      for (const field of service.cardCatalog || []) {
        add(service.id,service.name,'card','Card binding',field.label,field.id,field.type,
          'Use as fields[].binding in this plugin’s Card. This ID is not a {{...}} Task tag.',
          `${folder}/data/cards.json`, {binding:field.id});
        for (const column of field.columns || []) add(service.id,service.name,'column',`${field.label} · ${field.id}`,column.label,column.id,column.type,
          'List column ID. Select under listOptions.columns; not a standalone Task tag.',
          `${folder}/data/cards.json`, {listOptions:{columns:[column.id]}});
      }
      for (const field of (service.cardFields || []).filter(field => field.format !== 'secret')) {
        add(service.id,service.name,'declaration','Card field declaration',field.label,field.id,field.type,
          'Package field ID. Named sources can prefix this ID; use the Card binding entries above for configured source IDs.',
          `${folder}/declaration.json → cardFields[]`, {id:field.id,type:field.type});
      }
      for (const template of (service.cardTemplates || []).filter(template => template.preview)) {
        add(service.id,service.name,'slot',template.name,'Live preview image','data-card-preview','image',
          'Fixed package image element. The host reads this plugin’s bounded current JPEG; no URL or Task substitution is accepted.',
          `${folder}/declaration.json → runtime.preview; ${folder}/${template.directory}/${template.entry}`,
          {runtime:{preview:'jpeg-v1'},cardTemplates:[{id:template.id,preview:true}]});
      }
      for (const template of service.cardTemplates || []) for (const slot of template.slots || []) {
        add(service.id,service.name,'slot',template.name,slot.id,slot.id,slot.format || 'text',
          `Ready-made design slot bound to package field ${slot.field}. Fixed package layout, not free-text substitution.`,
          `${folder}/declaration.json → cardTemplates[].slots; ${folder}/${template.directory}/${template.entry}`,
          {id:slot.id,field:slot.field,format:slot.format || 'text'});
      }
    }
    return rows.sort((a,b) => (a.owner === b.owner ? 0 : a.owner === 'server' ? -1 : b.owner === 'server' ? 1 : a.ownerName.localeCompare(b.ownerName))
      || a.kind.localeCompare(b.kind) || a.context.localeCompare(b.context) || a.label.localeCompare(b.label));
  },

  filtered() {
    const query = this.search.trim().toLowerCase();
    return this.records().filter(row => (!this.owner || row.owner === this.owner) && (!this.kind || row.kind === this.kind)
      && (!query || [row.ownerName,row.kind,row.context,row.label,row.code,row.type,row.help,row.file].join(' ').toLowerCase().includes(query)));
  },

  row(row) {
    const code = escapeHtml(row.code), example = escapeHtml(JSON.stringify(row.example,null,2));
    const key=escapeHtml([row.owner,row.kind,row.context,row.code].join('|'));
    return `<article class="variable-entry" data-live-key="variable:${key}"><div><strong>${escapeHtml(row.label)}</strong><span class="variable-kind">${escapeHtml(row.kind)} · ${escapeHtml(row.type)}</span></div><p class="variable-context">${escapeHtml(row.context)}</p><div class="variable-token"><code>${code}</code><button type="button" class="button" data-variable-copy="${code}" aria-label="Copy ${code}">${icon('copy')}Copy</button></div><p>${escapeHtml(row.help)}</p><details data-variable-details="${key}" ${this.opened.has([row.owner,row.kind,row.context,row.code].join('|')) ? 'open' : ''}><summary>File reference and JSON example</summary><p><code>${escapeHtml(row.file)}</code></p><pre><code>${example}</code></pre><button class="button" type="button" data-variable-copy="${escapeHtml(JSON.stringify(row.example,null,2))}">Copy JSON</button></details></article>`;
  },

  results() {
    const rows = this.filtered(), shown = rows.slice(0,this.limit), groups = new Map();
    for (const row of shown) {
      if (!groups.has(row.owner)) groups.set(row.owner,{name:row.ownerName,rows:[]});
      groups.get(row.owner).rows.push(row);
    }
    return `<p class="inspection-count">${shown.length} of ${rows.length} matching entries · Updated from current declarations and configured sources</p>${[...groups.values()].map(group => `<section class="panel variable-group" data-live-key="variables:${escapeHtml(group.rows[0].owner)}"><div class="panel-header"><h2>${escapeHtml(group.name)}</h2></div><div class="variable-grid">${group.rows.map(row => this.row(row)).join('')}</div></section>`).join('') || '<div class="empty-state">No matching variables. Add named sources in plugin Settings to populate their bindings.</div>'}${rows.length > shown.length ? '<button class="button" data-action="variables-more">Show more entries</button>' : ''}`;
  },

  render() {
    const owners = [['server','Server'],...state.services.map(service => [service.id,service.name]).sort((a,b)=>a[1].localeCompare(b[1]))];
    const kinds = {event:'Event tags',card:'Card bindings',column:'List columns',slot:'Ready-made slots',action:'Task actions',parameter:'Action parameters',rule:'Start rules',declaration:'Card declarations'};
    return pageHeading('Variables','Tags, bindings and capability references') + `<section class="panel"><div class="panel-body variable-help"><p><code>{{event.field-id}}</code> inserts a captured Event value into Task text. Card bindings, columns and slots use their own IDs.</p><details data-variable-help ${this.helpOpen ? 'open' : ''}><summary>Usage and file editing</summary><p><code>{{event.field-id}}</code> inserts a captured public Event value into Log activity or a free-text Task action parameter. Choose the matching Event rule. Scheduled/manual starts without captured history do not provide Event values. Missing values stop the Task before effects.</p><p>There is no general expression language, arithmetic, JavaScript or arbitrary file/state lookup. Card IDs, List columns and ready-made slots belong to their own contexts; they are not interchangeable Task tags. No secret fields or live values are listed.</p><p>Paths are relative to the project root. JSON examples are fragments, not complete saved definitions. Use the administrator while running; stop Sormus before editing saved JSON files directly. Runtime/source schema changes appear here automatically through normal discovery and refresh.</p></details></div><div class="inspection-filters"><label class="inspection-search" for="variables-search">Search<input id="variables-search" type="search" value="${escapeHtml(this.search)}" placeholder="Find a tag, field, source or file"></label><label for="variables-owner">Owner<select id="variables-owner" aria-label="Owner"><option value="">Server and all plugins</option>${owners.map(([id,name])=>`<option value="${escapeHtml(id)}" ${id === this.owner ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label><label for="variables-kind">Context<select id="variables-kind" aria-label="Context"><option value="">All contexts</option>${Object.entries(kinds).map(([id,name])=>`<option value="${id}" ${id === this.kind ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div></section><div id="variables-results">${this.results()}</div>`;
  },

  update() { AdminDOM.update(document.querySelector('#variables-results'),this.results()); },
};

document.addEventListener('input',event=>{
  if(event.target.id !== 'variables-search')return;
  VariablesUI.search=event.target.value;VariablesUI.limit=100;VariablesUI.update();
});
document.addEventListener('change',event=>{
  if(!['variables-owner','variables-kind'].includes(event.target.id))return;
  VariablesUI[event.target.id === 'variables-owner' ? 'owner' : 'kind']=event.target.value;
  VariablesUI.limit=100;VariablesUI.update();
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-variable-copy], [data-action="variables-more"]');
  if(!button)return;
  if(button.dataset.action === 'variables-more'){VariablesUI.limit+=100;VariablesUI.update();return;}
  const value=button.dataset.variableCopy;
  try {
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
    else {
      // LAN HTTP may lack Clipboard API. Copy only on this explicit user click.
      const input=document.createElement('textarea');input.value=value;input.className='variable-copy-buffer';
      document.body.append(input);input.select();
      let copied;
      try {copied=document.execCommand('copy');}
      finally {input.remove();button.focus();}
      if(!copied)throw Error('Clipboard unavailable');
    }
    notify('Copied');
  } catch {notify('Copy unavailable. Select and copy the displayed code.');}
});

// Polling keeps a user's file-reference disclosure open without saving UI state.
document.addEventListener('toggle',event=>{
  const node=event.target;
  if(!node.isConnected)return;
  if(node.matches('[data-variable-help]')){VariablesUI.helpOpen=node.open;return;}
  if(!node.matches('[data-variable-details]'))return;
  if(node.open)VariablesUI.opened.add(node.dataset.variableDetails);
  else VariablesUI.opened.delete(node.dataset.variableDetails);
  while(VariablesUI.opened.size>1000)VariablesUI.opened.delete(VariablesUI.opened.values().next().value);
},true);
