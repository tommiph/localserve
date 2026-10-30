/** No administrator data or password is stored by the login page. */
'use strict';
const form=document.querySelector('#login-form'),error=document.querySelector('#login-error');
const allowed=new Set(['/','/index.html','/map-editor','/devices','/vr-library','/lighting-animations','/controller-setup','/lighting-scenes','/remotes','/downloads']);
const candidate=new URLSearchParams(location.search).get('return'),destination=allowed.has(candidate)?candidate:'/';
fetch('/api/access/status').then(response=>{if(!response.ok)throw Error('Unable to check sign-in.');return response.json();}).then(status=>{if(status.authenticated)location.replace(destination);}).catch(failure=>{error.textContent=failure.message;error.hidden=false;});
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=form.querySelector('[type="submit"]');if(button.disabled)return;button.disabled=true;error.hidden=true;
  try{const response=await fetch('/api/access/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:form.elements.password.value,name:form.elements.name.value})});const result=await response.json();if(!response.ok)throw Error(result.error||'Sign-in failed.');form.elements.password.value='';location.replace(destination);}
  catch(failure){form.elements.password.value='';error.textContent=failure.message;error.hidden=false;form.elements.password.focus();}finally{button.disabled=false;}
});
