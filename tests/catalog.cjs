'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {createCatalog,validId,safeUrl,normalize}=require('../version-catalog.cjs');
const {requiredMajor}=require('../java-runtime.cjs');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'10v12-catalog-'));
 try {
 for(const id of ['1.21.1','1.16.5','24w14a','b1.7.3','rd-132211','1.21-pre1'])assert(validId(id));
 for(const id of ['../secret','..','a/b','a\\b','<script>','',null])assert(!validId(id));
 for(const url of ['http://piston-meta.mojang.com/a','https://evil.example/a','https://user@piston-meta.mojang.com/a'])assert.throws(()=>safeUrl(url));
 for(const [id,major] of [['1.21.1',21],['1.20.5',21],['1.20.4',17],['1.18',17],['1.17.1',16],['1.16.5',8],['b1.7.3',8]])assert.equal(requiredMajor(id),major);
 const text=JSON.stringify({id:'1.21.1',javaVersion:{majorVersion:21}}),sha1=createHash('sha1').update(text).digest('hex');
 const manifest={versions:[{id:'1.21.1',type:'release',url:'https://piston-meta.mojang.com/v1/packages/test.json',sha1},{id:'24w14a',type:'snapshot',url:'https://piston-meta.mojang.com/v1/packages/snapshot.json',sha1}]};
 let calls=0;const fake=async url=>{calls++;return url.endsWith('version_manifest_v2.json')?Response.json(manifest):new Response(text);};
 const catalog=createCatalog({directory,fetchImpl:fake});assert.equal((await catalog.list()).versions.length,2);assert.equal((await catalog.details('1.21.1')).javaMajor,21);assert.equal(calls,2);await catalog.details('1.21.1');assert.equal(calls,2);
 await assert.rejects(catalog.details('../bad'));assert.equal(normalize({...manifest,versions:[...manifest.versions,manifest.versions[0]]}).length,2);
 const offline=createCatalog({directory,fetchImpl:async()=>{throw Error('OFFLINE');}});assert((await offline.list()).warning);assert.equal((await offline.details('1.21.1')).id,'1.21.1');
 await fs.rm(path.join(directory,'1.21.1.json'));const bad=createCatalog({directory,fetchImpl:async url=>url.endsWith('version_manifest_v2.json')?Response.json(manifest):new Response('corrupted')});await assert.rejects(bad.details('1.21.1'),/VERSION_HASH/);
 console.log('PASS: catalog fetch, all types, deduplication, metadata SHA1, offline cache, safe paths/hosts, Java selection. Network mocked.');
 }finally{await fs.rm(directory,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
