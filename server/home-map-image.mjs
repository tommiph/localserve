/** Floor-plan uploads use decoded, bounded PNG pixel data. Rebuilding the file
 * from its image chunks removes metadata and any trailing non-image content. */
import {inflateSync,deflateSync} from 'node:zlib';
import {HttpError} from './storage.mjs';

export const mapImageLimit = 6 * 1024 * 1024;
const signature = Buffer.from([137,80,78,71,13,10,26,10]);
const table = Uint32Array.from({length:256},(_,n)=>{
  let value=n;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
export function pngCrc(bytes) {
  let value=0xffffffff;for(const byte of bytes)value=table[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;
}
function chunk(type,data) {
  const head=Buffer.alloc(8);head.writeUInt32BE(data.length);head.write(type,4);
  const tail=Buffer.alloc(4);tail.writeUInt32BE(pngCrc(Buffer.concat([head.subarray(4),data])));
  return Buffer.concat([head,data,tail]);
}
export function canonicalMapPng(bytes) {
  const invalid=()=>{throw new HttpError(400,'Choose a valid PNG image. JPEG and WebP can be converted by the map editor.');};
  if(!Buffer.isBuffer(bytes)||bytes.length<45||bytes.length>mapImageLimit||!bytes.subarray(0,8).equals(signature))invalid();
  let offset=8,header=null,ended=false,idatEnded=false,total=0,count=0;const data=[];
  while(offset<bytes.length){
    if(++count>4096||offset+12>bytes.length)invalid();
    const size=bytes.readUInt32BE(offset),end=offset+12+size;
    if(end>bytes.length)invalid();
    const type=bytes.toString('ascii',offset+4,offset+8),body=bytes.subarray(offset+8,end-4);
    if(!/^[A-Za-z]{4}$/.test(type)||pngCrc(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))invalid();
    if(!header&&type!=='IHDR')invalid();
    if(type==='IHDR'){
      if(header||size!==13)invalid();header=Buffer.from(body);
      const width=header.readUInt32BE(0),height=header.readUInt32BE(4);
      if(width<1||height<1||width>8192||height>8192||width*height>24000000
        ||header[8]!==8||![2,6].includes(header[9])||header[10]||header[11]||header[12])invalid();
    }else if(type==='IDAT'){
      if(idatEnded||ended)invalid();total+=size;if(total>mapImageLimit)invalid();data.push(body);
    }else if(type==='IEND'){
      if(size||!data.length||end!==bytes.length)invalid();ended=true;
    }else{
      if(data.length)idatEnded=true;
      // RGB/RGBA PNGs need no palette or other critical chunks. Animated images
      // and transparency metadata are excluded; browser conversion yields RGBA.
      if(type[0]===type[0].toUpperCase()||['acTL','fcTL','fdAT','tRNS'].includes(type))invalid();
    }
    offset=end;
  }
  if(!ended)invalid();
  const width=header.readUInt32BE(0),height=header.readUInt32BE(4),stride=width*(header[9]===6?4:3)+1;
  let pixels;try{pixels=inflateSync(Buffer.concat(data),{maxOutputLength:stride*height});}catch{invalid();}
  if(pixels.length!==stride*height)invalid();
  for(let row=0;row<height;row++)if(pixels[row*stride]>4)invalid();
  const result=Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  if(result.length>mapImageLimit)throw new HttpError(413,'Choose a smaller floor-plan image.');
  return {width,height,bytes:result};
}
