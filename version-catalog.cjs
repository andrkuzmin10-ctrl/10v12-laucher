"use strict";
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const TYPES = ['release', 'snapshot', 'old_beta', 'old_alpha'];
function validId(id) { return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,99}$/.test(id) && !id.includes('..'); }
function safeUrl(value) {
 const u = new URL(value);
 if(u.protocol !== 'https:' || u.username || u.password || !['piston-meta.mojang.com','launchermeta.mojang.com'].includes(u.hostname)) throw Error('VERSION_SOURCE');
 return u.href;
}
function normalize(data) {
 if(!Array.isArray(data?.versions) || data.versions.length > 10000) throw Error('VERSION_MANIFEST');
 const seen=new Set();
 return data.versions.filter(v=>{if(!validId(v.id)||!TYPES.includes(v.type)||seen.has(v.id))return false;seen.add(v.id);return true;}).map(v=>{ safeUrl(v.url);
 if(!/^[a-f0-9]{40}$/i.test(v.sha1))throw Error('VERSION_HASH');
 return {id:v.id,type:v.type,url:v.url,sha1:v.sha1,releaseTime:v.releaseTime};
 });
}
function createCatalog({directory,fetchImpl=globalThis.fetch}) {
 let entries=[], pending, warning='';
 async function json(url) {
 const res=await fetchImpl(safeUrl(url),{signal:AbortSignal.timeout(30000)});
 if(!res.ok)throw Error('VERSION_HTTP');
 const text=await res.text(); if(Buffer.byteLength(text)>16*1024*1024)throw Error('VERSION_SIZE');return text;
 }
 async function load() {
 if(entries.length)return entries;
 if(pending)return pending;
 pending=(async()=>{
 try { const text=await json(MANIFEST);entries=normalize(JSON.parse(text));if(!entries.length)throw Error('VERSION_EMPTY');
 await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'manifest.json'),text).catch(()=>{});
 } catch {
 try {entries=normalize(JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8')));warning='Нет доступа к каталогу Mojang: используется сохранённый список.';} catch {entries=[];warning='Каталог Mojang недоступен. Проверь интернет и нажми «Обновить каталог».';}
 }
 return entries;
 })().finally(()=>{pending=null;});return pending;
 }
 async function list(refresh=false) {if(refresh && !pending){entries=[];warning='';}await load();return {versions:entries.map(({id,type,releaseTime})=>({id,type,releaseTime})),warning};}
 async function details(id) {
 const entry=(await load()).find(v=>v.id===id);if(!entry)throw Error('VERSION_UNKNOWN');
 await fs.mkdir(directory,{recursive:true});const file=path.join(directory,id+'.json');
 let text;try{text=await fs.readFile(file,'utf8');if(createHash('sha1').update(text).digest('hex')!==entry.sha1)text=null;}catch{}
 if(!text){text=await json(entry.url);if(createHash('sha1').update(text).digest('hex')!==entry.sha1)throw Error('VERSION_HASH');await fs.writeFile(file,text);}
 const data=JSON.parse(text);if(data.id!==id)throw Error('VERSION_ID');
 const {requiredMajor}=require('./java-runtime.cjs');
 return {...entry,javaMajor:data.javaVersion?.majorVersion || requiredMajor(id),metadata:data};
 }
 return {list,details};
}
module.exports={createCatalog,validId,normalize,safeUrl};
