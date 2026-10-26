'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');const {EventEmitter}=require('node:events');const lan=require('../lan-friends.cjs');
(async()=>{
 for(const ip of ['10.0.0.1','172.16.0.1','172.31.255.254','192.168.1.23','169.254.6.1'])assert(lan.privateIPv4(ip));
 for(const ip of ['8.8.8.8','127.0.0.1','0.0.0.0','224.0.2.60','172.32.1.1','192.168.1.999','192.168.01.2','::1','host.local','1.2.3.4;start cmd'])assert(!lan.privateIPv4(ip));
 for(const host of ['26.12.34.56','25.4.3.2','100.64.1.5'])assert.equal(lan.target({host,port:51234,version:'1.21.1',mode:'vpn'}).mode,'vpn');
 for(const host of ['203.0.113.15','play.example.net','server-1.example.net'])assert.equal(lan.target({host,port:25565,version:'1.21.1',mode:'server'}).host,host);
 for(const host of ['https://example.net','example.net:25565','example.net&calc','-test.net','foo..net','::1','224.0.2.60','0.0.0.0','127.0.0.1'])assert.throws(()=>lan.target({host,port:25565,version:'1.21.1',mode:'server'}));
 const t={host:'192.168.1.25',port:51324,version:'1.21.1'};
 assert.equal(lan.quickPlay(t).type,'multiplayer');assert.equal(lan.quickPlay({...t,version:'1.19.4'}).type,'legacy');assert.equal(lan.address(t),'192.168.1.25:51324');
 for(const port of [0,65536,1.5,'1e3','1&calc','-1'])assert.throws(()=>lan.target({...t,port}));assert.throws(()=>lan.target({...t,version:'../../bad'}));assert.equal(lan.target({...t,version:'1.16.5'}).version,'1.16.5');
 assert.equal(lan.interfaces({WiFi:[{internal:false,family:'IPv4',address:t.host}],Loop:[{internal:true,family:'IPv4',address:'127.0.0.1'}]}).length,1);
 assert.equal(lan.parseAnnouncement(Buffer.from('[MOTD]§aFriend world[/MOTD][AD]51324[/AD]'),t.host).name,'Friend world');assert.equal(lan.parseAnnouncement(Buffer.from('[MOTD]x[/MOTD][AD]0[/AD]'),t.host),null);assert.equal(lan.parseAnnouncement(Buffer.alloc(3000),t.host),null);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lan-friends-'));try{
 const file=path.join(dir,'friends.json'),store=lan.createFriendsStore(file);assert.deepEqual(await store.list(),[]);
 await Promise.all([store.add({...t,name:'Саша'}),store.add({...t,host:'192.168.1.26',name:'Маша'})]);let rows=await store.list();assert.equal(rows.length,2);await assert.rejects(store.add({...t,name:'Дубликат'}));
 rows=await store.remove(rows[0].id);assert.equal(rows.length,1);assert.equal((await lan.createFriendsStore(file).list())[0].name,'Маша');
 await fs.writeFile(file,'bad json');await assert.rejects(store.list());await assert.rejects(store.add({...t,name:'Не перезаписывать'}));assert.equal(await fs.readFile(file,'utf8'),'bad json');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
 let closed=false;const socket=new EventEmitter();socket.bind=(port,host,cb)=>{assert.equal(port,4445);cb();queueMicrotask(()=>{for(let i=0;i<2;i++)socket.emit('message',Buffer.from('[MOTD]Friend[/MOTD][AD]51324[/AD]'),{address:t.host});socket.emit('message',Buffer.from('[MOTD]Internet[/MOTD][AD]51324[/AD]'),{address:'8.8.8.8'});});};socket.addMembership=(group,iface)=>{assert.equal(group,'224.0.2.60');assert.equal(iface,t.host);};socket.close=()=>closed=true;
 const result=await lan.discover({socketFactory:()=>socket,adapters:[{host:t.host}],duration:30});assert.equal(result.worlds.length,1);assert(closed);
 const errSocket=new EventEmitter();errSocket.bind=()=>queueMicrotask(()=>errSocket.emit('error',Error('bind fail')));errSocket.close=()=>{};assert((await lan.discover({socketFactory:()=>errSocket,adapters:[{host:t.host}],duration:30})).warning);
 assert((await lan.discover({adapters:[]})).warning);
 console.log('PASS: LAN/VPN/server modes and migration; IPv4/domain filtering; LAN-only IPv4 and port validation; quickPlay 1.21/1.20 + legacy 1.19; atomic friend persistence/concurrency/removal; malformed file preserved; multicast parse/dedup/private filter/timeout/error/cleanup. Network mocked.');
})().catch(e=>{console.error(e);process.exit(1)});
