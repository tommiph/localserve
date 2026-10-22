/** QR handoff encodes only a bound private Home URL and keeps a text fallback. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const read=file=>fs.readFile(new URL('../'+file,import.meta.url),'utf8');
const vendor=await read('assets/qrcode/qrcodegen.js'),source=await read('web/phone-home-ui.js');
function fixture(encoder=true) {
  const state={server:{lanAddress:null}},context=vm.createContext({state,URL,escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;'),icon:()=>'',document:{addEventListener(){}}});
  if(encoder)vm.runInContext(vendor,context);
  vm.runInContext(source+'\nglobalThis.phone=PhoneHomeUI;',context);
  return {context,state,phone:context.phone};
}

test('handoff excludes loopback, external, malformed and credential-bearing addresses',()=>{
  const {phone,state}=fixture();
  for(const value of [null,'http://127.0.0.1:7041','http://localhost:7041','https://192.168.1.2','http://8.8.8.8','http://172.32.1.2','http://10.1.2.3/home','http://10.1.2.3?token=secret','http://10.1.2.3/#secret','http://name:secret@10.1.2.3','http://10.1.2.3:0']){
    state.server.lanAddress=value;
    assert.equal(phone.homeAddress(),null,value);
    assert.doesNotMatch(phone.connection(),/<svg/);
  }
});

test('handoff caches a bounded QR with quiet zone, accessible name and original text address',()=>{
  const {context,phone,state}=fixture();
  for(const origin of ['http://10.1.2.3:7041','http://172.16.2.3:8080','http://192.168.1.2:65535']){
    state.server.lanAddress=origin;
    const address=phone.homeAddress(),markup=phone.connection();
    assert.equal(address,origin+'/home');assert.match(markup,/Scan to open Phone Home/);
    assert.ok(markup.includes('value="'+address+'"'));assert.match(markup,/fill="#fff"/);assert.match(markup,/fill="#000"/);
    const qr=phone.qrCache;assert.equal(phone.qr(address),qr.markup);assert.equal(phone.qrCache,qr);
    // A private URL is small enough for a bounded version-5 symbol.
    const size=Number(/viewBox="0 0 (\d+)/.exec(qr.markup)[1]);assert.ok(size>=29&&size<=45);
    for(const match of qr.markup.matchAll(/M(\d+),(\d+)h1v1h-1z/g))for(const n of [Number(match[1]),Number(match[2])])assert.ok(n>=4&&n<size-4);
  }
  const encoder=context.qrcodegen.QrCode.encodeSegments;
  context.qrcodegen.QrCode.encodeSegments=()=>{throw Error('Unavailable');};phone.qrCache=null;
  assert.match(phone.connection(),/Phone Home address/);assert.doesNotMatch(phone.connection(),/<svg/);
  context.qrcodegen.QrCode.encodeSegments=encoder;
  const fallback=fixture(false);fallback.state.server.lanAddress='http://10.1.2.3:7041';
  assert.match(fallback.phone.connection(),/Copy address/);assert.doesNotMatch(fallback.phone.connection(),/<svg/);
});

test('bundled QR source retains its pinned bytes, license and local loading boundary',async()=>{
  const bytes=await fs.readFile(new URL('../assets/qrcode/qrcodegen.js',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'2511bc17f40a3c41d4a0578995db956b38997334d3d20113a5d4dc5c49c69480');
  assert.match(vendor,/Permission is hereby granted/);
  const html=await read('web/index.html');assert.match(html,/<script src="assets\/qrcode\/qrcodegen.js" defer>/);
  assert.ok(html.indexOf('assets/qrcode/qrcodegen.js')<html.indexOf('phone-home-ui.js'));
  assert.doesNotMatch(source,/https:\/\/(?:api|chart|qr)/);
});
