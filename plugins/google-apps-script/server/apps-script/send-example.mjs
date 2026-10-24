/** Send one explicit external Event using a privately stored relay profile.
 * Keys stay out of command arguments, console output and URL parameters. */
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {relayClient} from '../../../../server/relay-protocol.mjs';
const [file,channel,message]=process.argv.slice(2);
if(!file||!channel||channel.length>64||typeof message!=='string'||message.length>2000)throw Error('Use: send-example.mjs private-profile.json channel "message"');
const profile=JSON.parse(await fs.readFile(file,'utf8'));
const client=relayClient(profile.url,profile.clientId,profile.key);
const result=await client('event',{id:randomUUID(),channel,message},AbortSignal.timeout(20000));
console.log(JSON.stringify({id:result.id,status:result.status}));
