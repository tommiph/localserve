/** Named palettes contain colours only. They cannot inject CSS, URLs or markup.
 * Defaults are projected without rewriting an existing installation's settings. */
import {HttpError} from './storage.mjs';

export const colorKeys=Object.freeze(['canvas','surface','surfaceMuted','text','muted','border','accent']);
export const exampleThemes=Object.freeze([
  {id:'midnight',name:'Midnight blue',mode:'dark',enabled:true,colors:{canvas:'#101827',surface:'#19253a',surfaceMuted:'#223149',text:'#edf4ff',muted:'#a9bad1',border:'#354760',accent:'#83b8ff'}},
  {id:'forest',name:'Forest',mode:'dark',enabled:true,colors:{canvas:'#111d19',surface:'#1b2b24',surfaceMuted:'#25392f',text:'#edf5ee',muted:'#b1c5b6',border:'#3b5143',accent:'#9bd49e'}},
  {id:'sand',name:'Sand',mode:'light',enabled:true,colors:{canvas:'#f3eee5',surface:'#fffaf2',surfaceMuted:'#eee5d7',text:'#302b25',muted:'#73685b',border:'#d6c9b7',accent:'#91602e'}},
]);
export const themeCatalogue=config=>structuredClone(config.colorThemes??exampleThemes);

export function validateColorThemes(config){
  if(Object.hasOwn(config,'colorThemes')&&!Array.isArray(config.colorThemes))throw new HttpError(400,'Color themes must be a list.');
  const themes=themeCatalogue(config);
  if(!Array.isArray(themes)||themes.length>12)throw new HttpError(400,'Keep up to 12 color themes.');
  const ids=new Set();
  for(const theme of themes){
    if(!theme||Object.keys(theme).some(key=>!['id','name','mode','enabled','colors'].includes(key))||
      typeof theme.id!=='string'||!/^[a-z0-9-]{1,64}$/.test(theme.id)||ids.has(theme.id)||
      typeof theme.name!=='string'||!theme.name.trim()||theme.name.length>48||/[\u0000-\u001f]/.test(theme.name)||
      !['light','dark'].includes(theme.mode)||typeof theme.enabled!=='boolean'||!theme.colors||
      Object.keys(theme.colors).length!==colorKeys.length||colorKeys.some(key=>!/^#[0-9a-f]{6}$/i.test(theme.colors[key])))
      throw new HttpError(400,'Use a unique theme name and ID, a light or dark base, and seven six-digit hex colors.');
    ids.add(theme.id);
  }
  for(const key of ['adminColorTheme','displayColorTheme']){
    const value=config[key]??'';
    if(typeof value!=='string'||value&&!themes.some(theme=>theme.id===value&&theme.enabled))throw new HttpError(400,'Choose an enabled color theme or Default colors.');
  }
}

/** Display readers receive only their active palette, never the administrator
 * catalogue, theme names or settings. Branded card artwork keeps its own motif. */
export function displayPalette(config){
  const theme=themeCatalogue(config).find(theme=>theme.id===config.displayColorTheme&&theme.enabled);
  return theme?{mode:theme.mode,colors:theme.colors}:null;
}
