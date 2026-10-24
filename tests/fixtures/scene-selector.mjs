/** Disposable selector server; all scene effects are synthetic log entries. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createLocalserve} from '../../server.mjs';
import {validateTask} from '../../server/tasks.mjs';
export async function selectorFixture() {
  const source=path.resolve(import.meta.dirname,'../..'),base=path.join(source,'tests/.tmp');
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'scene-selector-'));
  for(const folder of ['web','assets/material-symbols','assets/controls','assets/scenes'])await fs.cp(path.join(source,folder),path.join(root,folder),{recursive:true});
  await fs.copyFile(path.join(source,'package.json'),path.join(root,'package.json'));
  await fs.copyFile(path.join(source,'styles.css'),path.join(root,'styles.css'));
  const folder=path.join(root,'plugins/tradfri');await fs.mkdir(path.join(folder,'server'),{recursive:true});
  const declaration=JSON.parse(await fs.readFile(path.join(source,'plugins/tradfri/declaration.json'),'utf8'));
  declaration.runtime.entry='server/fixture.mjs';delete declaration.cardTemplates;
  await fs.writeFile(path.join(folder,'declaration.json'),JSON.stringify(declaration));
  await fs.writeFile(path.join(folder,'server/fixture.mjs'),`export default {async validateConfiguration(){return true;},async start(){},async stop(){},async execute(id,values,context){await context.wait(.08);await context.log('Synthetic scene effect');return {completed:true};}};`);
  const app=await createLocalserve(root,{automatic:false});
  try {
  await app.registry.saveConfiguration('tradfri',{revision:1,enabled:true});
  const names=['Everyday','Soft evening','Movie night','Reading','Dinner','All lights off'],icons=['sun','moon','movie','book','restaurant','power-off'];
  const page=await app.controls.save('tradfri',{schemaVersion:1,name:'Living room',slug:'lights',enabled:true,icon:'lightbulb',columns:3,presentation:'lighting',items:names.map((label,i)=>({id:'scene-'+i,label,icon:icons[i],kind:'scene',enabled:true,steps:[{id:'step',actionId:'light-power',parameters:{id:'1',on:i!==5}}]}))});
  const taskNames=['Start the evening','Ten-minute break','Open my display'];
  for(let i=0;i<taskNames.length;i++) {
    const task=validateTask({name:taskNames[i],enabled:true,starts:[],steps:[{id:'log',enabled:true,type:'log',message:'Synthetic shortcut'}]},null,app.registry.actions(),app.registry.events(),[]);
    await app.tasks.update(items=>items.push(task));
  }
  await app.phoneHome.save({revision:app.phoneHome.admin().revision,tasks:app.tasks.snapshot().map((task,i)=>({taskId:task.id,icon:['home','bed','tv'][i],enabled:true}))});
  return {app,root,page,async close(){await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});}};
  } catch(error) {await app.close();assert.equal(path.dirname(root),base);await fs.rm(root,{recursive:true,force:true});throw error;}
}
