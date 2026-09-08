const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('./core.js');require('./group-icons.js');require('./channel-groups.js');require('./group-sharing.js');
const {animatedGif}=require('./icon-fixtures.cjs');
const A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),C='UC'+'c'.repeat(22);
const gif={kind:'image',value:'data:image/gif;base64,'+animatedGif().toString('base64')};
function fixture(){return {version:1,collapsed:true,groups:[
  {id:'private-id',name:'Podcasts',channelIds:[A,B],icon:gif,createdAt:1,updatedAt:2,watchFilter:'watched',hideShorts:true},
  {id:'other-private-id',name:'日本語',channelIds:[B,C],icon:{kind:'emoji',value:'🎧'},createdAt:3,updatedAt:4}
],channels:Object.fromEntries([[A,'Alpha'],[B,'Beta'],[C,'Private other channel']].map(([id,name])=>[id,{id,name,url:'https://www.youtube.com/channel/'+id,avatarUrl:'https://yt3.ggpht.com/avatar',avatarCheckedAt:123,notes:'private'}]))};}
test('sharing exports only chosen groups and public channel identity; icons are optional',()=>{
  const original=fixture(),before=structuredClone(original),text=GroupSharing.exportGroups(original,['private-id']);
  const bundle=JSON.parse(text);assert.deepEqual(Object.keys(bundle).sort(),['channels','format','groups','schemaVersion']);
  assert.deepEqual(bundle.groups,[{name:'Podcasts',icon:gif,channelIds:[A,B]}]);
  assert.deepEqual(bundle.channels,[{id:A,name:'Alpha'},{id:B,name:'Beta'}]);
  for(const privateText of ['private-id','avatar','watchFilter','hideShorts','createdAt','updatedAt','notes','Private other channel'])assert.equal(text.includes(privateText),false,privateText);
  assert.deepEqual(original,before);
  const bare=JSON.parse(GroupSharing.exportGroups(original,['private-id'],false));assert.equal(bare.groups[0].icon,undefined);assert.equal(JSON.stringify(bare).includes('base64'),false);
  assert.throws(()=>GroupSharing.exportGroups(original,[]),/Choose/);assert.throws(()=>GroupSharing.exportGroups(original,['gone']),/changed/);
});
test('imports create fresh independent groups, resolve collisions and preserve existing preferences/channels',()=>{
  const state=fixture(),before=structuredClone(state),bundle=GroupSharing.parse(GroupSharing.exportGroups(state,['private-id','other-private-id']));
  bundle.groups[0].channelIds.push(A);bundle.groups[0].watchFilter='hidden';bundle.channels[0].name='Sender rename';
  const clean=GroupSharing.validate(bundle);let counter=0;
  const updated=GroupSharing.importGroups(state,clean,[0],true,()=> 'new-'+ ++counter,500);
  assert.deepEqual(state,before);assert.deepEqual(updated.groups.slice(0,2),before.groups);assert.deepEqual(updated.channels,before.channels);
  assert.deepEqual(updated.groups[2],{id:'new-1',name:'Podcasts (2)',channelIds:[A,B],icon:gif,createdAt:500,updatedAt:500});
  assert.equal(updated.collapsed,true);
  const repeated=GroupSharing.importGroups(updated,clean,[0],false,()=> 'new-2',600);assert.equal(repeated.groups[3].name,'Podcasts (3)');assert.equal(repeated.groups[3].icon,undefined);
  const empty=GroupSharing.importGroups(undefined,clean,[1],true,()=> 'fresh',700);assert.deepEqual(empty.groups[0].channelIds,[B,C]);assert.deepEqual(Object.keys(empty.channels),[B,C]);assert.equal(empty.channels[B].url,'https://www.youtube.com/channel/'+B);
});
test('untrusted files cannot add URLs, settings, executable icons, local IDs, or unsupported shapes',()=>{
  const good=JSON.parse(GroupSharing.exportGroups(fixture(),['private-id']));
  for(const mutate of [
    x=>x.schemaVersion=2,x=>x.groups=[],x=>x.groups[0].channelIds=['bad'],x=>x.groups[0].name=' ',
    x=>x.channels[0].id=[A],x=>x.channels.push(x.channels[0]),x=>x.channels[0].name=7,
    x=>x.groups[0].icon={kind:'image',value:'https://example.com/tracker.gif'},
    x=>x.groups[0].icon={kind:'image',value:'data:image/svg+xml;base64,PHN2Zz4='}
  ]){const invalid=structuredClone(good);mutate(invalid);assert.throws(()=>GroupSharing.parse(JSON.stringify(invalid)));}
  assert.throws(()=>GroupSharing.parse('not json'),/valid JSON/);assert.throws(()=>GroupSharing.parse('x'.repeat(GroupSharing.maxBytes+1)),/10 MB/);
  assert.throws(()=>GroupSharing.parse(JSON.stringify({format:'youtube-ledger-backup',data:{}})),/Profile backups/);
  const dirty=structuredClone(good);dirty.settings={theme:'classic'};dirty.groups[0].id='victim';dirty.channels[0].url='https://evil.test';dirty.channels[0].avatarUrl='https://evil.test/tracker';
  const imported=GroupSharing.importGroups(undefined,GroupSharing.parse(JSON.stringify(dirty)),[0],true,()=> 'generated');
  assert.equal(imported.settings,undefined);assert.equal(imported.groups[0].id,'generated');assert.equal(imported.channels[A].url,'https://www.youtube.com/channel/'+A);assert.equal(imported.channels[A].avatarUrl,undefined);
});
test('limits reject an import as a whole and icons can be omitted when combined storage is full',()=>{
  const original=fixture(),bundle=GroupSharing.parse(GroupSharing.exportGroups(original,['private-id']));
  const full=structuredClone(original);full.groups=Array.from({length:200},(_,i)=>({...original.groups[0],id:String(i),name:'Group '+i}));
  assert.throws(()=>GroupSharing.importGroups(full,bundle,[0]),/200 groups/);assert.equal(full.groups.length,200);
  for(const indices of [[],[0,0],[2],['0']])assert.throws(()=>GroupSharing.importGroups(original,bundle,indices),/Choose/);
  const padded=Buffer.alloc(500*1024);animatedGif().copy(padded);const large={kind:'image',value:'data:image/gif;base64,'+padded.toString('base64')};
  const images=structuredClone(original);images.groups[0].icon=large;images.groups[1].icon=large;
  bundle.groups[0].icon=large;bundle.groups.push({...bundle.groups[0],name:'Music'});
  assert.throws(()=>GroupSharing.importGroups(images,bundle,[0,1]),/Uncheck Include/);
  assert.equal(GroupSharing.importGroups(images,bundle,[0,1],false).groups.length,4);
});
test('background import is serialized, authorized, atomic, and touches only group storage',async()=>{
  const data={'channelGroups:v1':fixture(),settings:{theme:'classic'},'day:2026-09-07':[{private:'history'}],'groupBrowsing:v1':{private:'hidden videos'}};
  let quota=false;const writes=[];
  const browser={runtime:{getURL:p=>'moz-extension://test/'+p},storage:{local:{
    async get(key){return {[key]:structuredClone(data[key])};},async set(values){if(quota)throw new Error('quota');await new Promise(r=>setTimeout(r,1));writes.push(Object.keys(values));Object.assign(data,structuredClone(values));}
  }}};
  const context=vm.createContext({browser,Ledger,GroupIcons,structuredClone,crypto,TextEncoder,URL,console,setTimeout});
  for(const file of ['ledger-storage.js','channel-groups.js','group-sharing.js'])vm.runInContext(fs.readFileSync(file,'utf8'),context);
  const sender={url:browser.runtime.getURL('dashboard.html')+'#groups'},text=GroupSharing.exportGroups(fixture(),['private-id']);
  const message={type:'channelGroups:share:import',text,indices:[0]},api=context.ChannelGroups,before=structuredClone(data);
  for(const bad of [{url:'https://evil.test/'},{url:'https://www.youtube.com/',tab:{incognito:true}}])await assert.rejects(api.handle(message,bad),/cannot edit/);
  assert.deepEqual(data,before);
  await api.handle({type:'channelGroups:share:preview',text},sender);assert.deepEqual(data,before,'Preview does not save');
  const results=await Promise.all([api.handle(message,sender),api.handle(message,sender)]);
  assert.equal(results[0].groups[0].name,'Podcasts (2)');assert.equal(results[1].groups[0].name,'Podcasts (3)');
  for(const [k,v] of Object.entries(before))if(k!=='channelGroups:v1')assert.deepEqual(data[k],v);
  assert.ok(writes.every(keys=>JSON.stringify(keys)==='["channelGroups:v1"]'));
  const saved=structuredClone(data);quota=true;await assert.rejects(api.handle(message,sender),/storage is full/);assert.deepEqual(data,saved);
});
