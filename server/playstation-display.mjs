/** A read-only display DTO: declared PSN readings and bounded session receipts.
 * Never return configuration, account IDs, action tokens or raw provider state. */
export function playstationDisplay(registry, configuration, now = Date.now()) {
  const service = registry.services().find(item => item.id === 'playstation');
  const fields = service?.enabled ? service.cardFields.filter(field => ['state','rows'].includes(field.source.kind)) : [];
  const values = {}, catalog = [];
  for (const field of fields) {
    const datum = service.cardData?.values[field.id];
    if (!datum) continue;
    values[field.id] = structuredClone(datum);
    catalog.push({id:field.id,label:field.label,type:field.type,
      ...(field.columns ? {columns:field.columns.map(({id,label,type})=>({id,label,type}))} : {})});
  }
  const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/gu,' ').slice(0,200) : '';
  const seen = new Set();
  const activity = service?.enabled ? (service.pluginActivity || [])
    .filter(entry => ['session-activity','presence-changed'].includes(entry.eventId)
      && Number.isFinite(entry.at) && entry.payload && typeof entry.payload === 'object')
    .filter(entry => {
      // New receipts follow the ordinary presence receipt in the same plugin
      // log. Show each committed transition once; never return its private key.
      const key = entry.payload['change-id'];
      if (typeof key !== 'string') return true;
      if (seen.has(key)) return false;
      seen.add(key);return true;
    }).slice(0,60).map(entry => {
      const current = entry.eventId === 'session-activity';
      const value = entry.payload;
      return {at:entry.at, kind:current && ['online','offline','game','presence'].includes(value.kind) ? value.kind : 'presence',
        status:['online','offline','away','unknown'].includes(value.status) ? value.status : 'unknown',
        game:text(value.game), previousGame:current ? text(value['previous-game']) : '',
        seconds:current && Number.isFinite(value['session-seconds']) && value['session-seconds'] >= 0 ? value['session-seconds'] : null};
    }) : [];
  const config = configuration.snapshot();
  return {enabled:Boolean(service?.enabled),status:service?.cardData?.status || 'Unavailable',values,catalog,activity,
    options:{now,serverName:config.name,timeFormat:config.timeFormat,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      pollSeconds:service?.pollSeconds || 0,retentionDays:config.activityRetentionDays},
    video:{source:'HDMI',number:1,rectangle:['2%','2%','50%','50%']}};
}
