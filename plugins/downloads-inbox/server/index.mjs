import path from 'node:path';
export default {
 validateConfiguration(s){return (!s.folder||path.isAbsolute(s.folder))&&(!s['qbittorrent-path']||path.isAbsolute(s['qbittorrent-path'])&&/^qbittorrent(?:\.exe)?$/i.test(path.basename(s['qbittorrent-path'])))&&Number.isInteger(s['max-file-mib']);},
 async start(){},async stop(){},async execute(){throw Error('Downloads are submitted through the paired file receiver.');}
};
