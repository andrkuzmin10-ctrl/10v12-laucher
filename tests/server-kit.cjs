'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');const {createHash}=require('node:crypto');
const {setup,safeUrl}=require('../server-kit/start.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'10v12-server-test-'));let calls=0;const bytes=Buffer.from('synthetic server JAR fixture, NOT executable'),sha1=createHash('sha1').update(bytes).digest('hex');
 const fake=async url=>{calls++;if(url.endsWith('version_manifest_v2.json'))return Response.json({versions:[{id:'1.21.1',url:'https://piston-meta.mojang.com/v1/packages/test.json'}]});if(url.endsWith('test.json'))return Response.json({downloads:{server:{url:'https://piston-data.mojang.com/v1/objects/test/server.jar',sha1,size:bytes.length}}});if(url.endsWith('server.jar'))return new Response(bytes);throw Error('unexpected URL');};
 try{
 const dir=path.join(root,'server');await assert.rejects(setup({directory:dir,ask:async()=> 'НЕТ',fetchImpl:fake,log:()=>{}}),/EULA/);assert.equal(calls,0);
 const result=await setup({directory:dir,ask:async()=> 'ДА',fetchImpl:fake,log:()=>{}});assert.equal(calls,3);assert.equal(await fs.readFile(result.jar,'utf8'),bytes.toString());const props=await fs.readFile(path.join(result.game,'server.properties'),'utf8');assert(props.includes('online-mode=true'));assert(props.includes('white-list=true'));assert(!props.includes('enable-rcon=true'));
 await fs.mkdir(path.join(result.game,'world'));await fs.writeFile(path.join(result.game,'world','keep.dat'),'KEEP WORLD');await setup({directory:dir,ask:async()=>{throw Error('must use saved EULA');},fetchImpl:async()=>{throw Error('must use cached JAR');},log:()=>{}});assert.equal(await fs.readFile(path.join(result.game,'world','keep.dat'),'utf8'),'KEEP WORLD');
 const propertiesFile=path.join(result.game,'server.properties');await fs.writeFile(propertiesFile,props.replace('online-mode=true','online-mode=false'));await assert.rejects(setup({directory:dir,ask:async()=>'',fetchImpl:fake,log:()=>{}}),/online-mode/);assert((await fs.readFile(propertiesFile,'utf8')).includes('online-mode=false'));await fs.writeFile(propertiesFile,props);
 await fs.writeFile(path.join(dir,'server-config.json'),JSON.stringify({version:'1.20.1',ram:2,port:25565}));await assert.rejects(setup({directory:dir,ask:async()=>'',fetchImpl:fake,log:()=>{}}),/Версия/);assert.equal(await fs.readFile(path.join(result.game,'world','keep.dat'),'utf8'),'KEEP WORLD');
 const bad=path.join(root,'bad');await assert.rejects(setup({directory:bad,ask:async()=> 'yes',fetchImpl:async url=>url.endsWith('server.jar')?new Response(Buffer.from('CORRUPTED')):fake(url),log:()=>{}}),/сумма|Размер/);await assert.rejects(fs.access(path.join(bad,'game','server.jar')));await assert.rejects(fs.access(path.join(bad,'game','server.jar.download')));
 assert.throws(()=>safeUrl('https://example.org/server.jar'));assert.throws(()=>safeUrl('http://piston-data.mojang.com/server.jar'));
 console.log('PASS: explicit EULA gate/no download on denial; official-host filter; SHA1 + length; cached offline reuse; auth + whitelist defaults; existing world preserved; version change refused; corrupt JAR rejected and temp cleaned. Synthetic fixture, no Minecraft/Java launch.');
 }finally{await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1)});
