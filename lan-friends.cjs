'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const dgram = require('node:dgram');
const { randomUUID } = require('node:crypto');
const { validId } = require('./version-catalog.cjs');
function invalid(text) { const e = new Error(text); e.code = 'LAN_INPUT'; return e; }
function privateIPv4(value) {
  if (typeof value !== 'string' || net.isIP(value) !== 4) return false;
  const [a,b] = value.split('.').map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
}
function usableIPv4(host) {
  if(net.isIP(host)!==4)return false;
  const [a]=host.split('.').map(Number);return a>0&&a<224&&a!==127;
}
function serverHost(host) {
  if(typeof host!=='string'||host.length>253||/[\s/:\\@?#]/.test(host))return false;
  if(net.isIP(host)===4)return usableIPv4(host);
  if(/^[\d.]+$/.test(host))return false;
  return host.includes('.') && host.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}
function target(value) {
  if (!value || typeof value !== 'object') throw invalid('Укажи адрес и порт подключения.');
  const host=typeof value.host==='string'?value.host.trim().toLowerCase():'';
  const mode=value.mode===undefined?'lan':value.mode;
  if(!['lan','vpn','server'].includes(mode))throw invalid('Выбери тип: локальная сеть, VPN или сервер.');
  if(mode==='lan'&&!privateIPv4(host))throw invalid('Для LAN нужен локальный IPv4, например 192.168.1.15. Для VPN или сервера переключи тип подключения.');
  if(mode==='vpn'&&!usableIPv4(host))throw invalid('Введи IPv4 VPN-адаптера хозяина, например 26.12.34.56. Без http:// и порта.');
  if(mode==='server'&&!serverHost(host))throw invalid('Введи IPv4 или домен сервера (например play.example.net). Порт укажи отдельно. IPv6 пока не поддерживается.');
  const port=typeof value.port==='number'?value.port:typeof value.port==='string'&&/^\d{1,5}$/.test(value.port)?Number(value.port):NaN;
  if(!Number.isInteger(port)||port<1||port>65535)throw invalid('Порт — целое число от 1 до 65535: из чата LAN-мира или панели сервера.');
  if(!validId(value.version))throw invalid('Выбери ту же версию Minecraft, что у хозяина/сервера.');
  return {host,port,version:value.version,mode};
}
function address(value) { const v = target(value); return `${v.host}:${v.port}`; }
function quickPlay(value) { const v = target(value); return { type: /^1\.(?:[0-9]|1[0-9])(?:\.|$)/.test(v.version) ? 'legacy' : 'multiplayer', identifier: address(v) }; }
function interfaces(all = os.networkInterfaces()) {
  const result = [];
  for (const [name, entries] of Object.entries(all)) for (const i of entries || []) {
    if (!i.internal && (i.family === 'IPv4' || i.family === 4) && usableIPv4(i.address) && !result.some(v => v.host === i.address)) result.push({ name: String(name).slice(0,60), host:i.address });
  }
  return result.slice(0,16);
}
function cleanName(value) { return typeof value === 'string' ? value.replace(/§./g,'').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,48) : ''; }
function createFriendsStore(file) {
  let queue = Promise.resolve();
  async function list() {
    let data; try { data = JSON.parse(await fs.readFile(file,'utf8')); } catch(e) { if (e.code === 'ENOENT') return []; throw invalid('Не удалось прочитать список друзей. Сохрани резервную копию friends.json и проверь файл.'); }
    if (!Array.isArray(data) || data.length > 30) throw invalid('Файл друзей повреждён или слишком большой.');
    return data.map(v => { const t = target(v); if (!/^[a-f0-9-]{36}$/i.test(v.id) || !cleanName(v.name)) throw invalid('В файле друзей есть некорректная запись.'); return {id:v.id,name:cleanName(v.name),...t}; });
  }
  async function write(items) { await fs.mkdir(path.dirname(file),{recursive:true}); const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(items,null,2),'utf8');await fs.rename(tmp,file); }
  function serialize(fn) { const result=queue.then(fn);queue=result.catch(()=>{});return result; }
  return {
    list:()=>queue.then(list),
    add:value=>serialize(async()=>{const t=target(value),name=cleanName(value.name);if(!name)throw invalid('Введи имя друга.');const items=await list();if(items.length>=30)throw invalid('В списке уже 30 друзей. Удали ненужную запись.');if(items.some(v=>v.host===t.host&&v.port===t.port))throw invalid('Такой адрес уже сохранён. Если порт изменился, удали старую запись и добавь новую.');items.push({id:randomUUID(),name,...t});await write(items);return items;}),
    remove:id=>serialize(async()=>{if(typeof id!=='string')throw invalid('Выбери друга из списка.');const items=await list();await write(items.filter(v=>v.id!==id));return items.filter(v=>v.id!==id);})
  };
}
function parseAnnouncement(message, host) {
  if (!privateIPv4(host) || message.length > 2048) return null;
  const text = message.toString('utf8'), match = /^\[MOTD\]([\s\S]*?)\[\/MOTD\]\[AD\](\d{1,5})\[\/AD\]$/.exec(text);
  if (!match) return null; const port=Number(match[2]);if(port<1||port>65535)return null;
  return { host,port,name:cleanName(match[1])||'Мир в локальной сети' };
}
/** Passive LAN announcements only. No port scans, probes, background listeners or internet requests. */
function discover({ socketFactory=options=>dgram.createSocket(options), adapters=interfaces().filter(i=>privateIPv4(i.host)), duration=4500 }={}) {
  if (!adapters.length) return Promise.resolve({ worlds:[], warning:'Не найден локальный IPv4. Подключись к общей сети Wi-Fi или Ethernet.' });
  return new Promise(resolve=>{
    const socket=socketFactory({type:'udp4',reuseAddr:true});const found=new Map();let done=false,timer;
    const finish=warning=>{if(done)return;done=true;clearTimeout(timer);try{socket.close();}catch{}resolve({worlds:[...found.values()],...(warning?{warning}:{})});};
    socket.on('error',()=>finish('Поиск LAN недоступен. Подключись вручную по адресу и порту; проверь разрешения частной сети.'));
    socket.on('message',(message,rinfo)=>{if(done||found.size>=32)return;const row=parseAnnouncement(message,rinfo.address);if(row)found.set(`${row.host}:${row.port}`,row);});
    timer=setTimeout(()=>finish(),duration);
    try { socket.bind(4445,'0.0.0.0',()=>{let joined=0;for(const a of adapters)try{socket.addMembership('224.0.2.60',a.host);joined++;}catch{}if(!joined)finish('Не удалось включить поиск в этой сети. Используй ручное подключение.');}); }
    catch { finish('Не удалось открыть поиск LAN. Используй ручное подключение.'); }
  });
}
module.exports = { usableIPv4,serverHost,privateIPv4,target,address,quickPlay,interfaces,createFriendsStore,parseAnnouncement,discover };
