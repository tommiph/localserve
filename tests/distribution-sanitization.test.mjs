/** Public packaging must preserve its boundary when rebuilt from clean source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeOculusReadings,initializeSourceLauncher} from '../tools/distribution/sanitize-source.mjs';

test('Oculus source sanitization is idempotent and preserves generic readings',()=>{
  const generic="return { 'active-package': pkg, 'active-app': pkg?.startsWith('com.oculus.') ? 'Oculus system' : pkg };";
  const configured=generic.replace("'active-app': ","'active-app': pkg === 'org.example.privateapp' ? 'Home VR'\r\n : ");
  const clean=sanitizeOculusReadings(configured);
  assert.equal(clean,generic);
  assert.equal(sanitizeOculusReadings(clean),clean);
  assert.equal(sanitizeOculusReadings(generic),generic);
  assert.doesNotMatch(clean,/privateapp|Home VR/);
});

test('Oculus packaging rejects absent, ambiguous and changed reading contracts',()=>{
  for(const source of ['',"return { 'active-app': pkg };", "'active-app': pkg?.startsWith('com.oculus.') ? 'Oculus system' : pkg }; 'active-app': pkg"]){
    assert.throws(()=>sanitizeOculusReadings(source));
  }
  assert.throws(()=>sanitizeOculusReadings(null),TypeError);
});

test('source launcher rebuilding initializes once and rejects ambiguous launch order',()=>{
  const source='@echo off\r\ncd /d "%~dp0"\r\nstart "" "tray\\LocalserveTray.exe"\r\n';
  const prepared=initializeSourceLauncher(source);
  assert.equal(initializeSourceLauncher(prepared),prepared);
  assert.equal(prepared.split('tools\\initialize-settings.mjs').length-1,1);
  assert.match(prepared,/if errorlevel 1 exit \/b 1/);
  assert.throws(()=>initializeSourceLauncher('start different.exe'));
  assert.throws(()=>initializeSourceLauncher(source+'"runtime\\node.exe" "tools\\initialize-settings.mjs"'));
  assert.throws(()=>initializeSourceLauncher(prepared+source));
});
