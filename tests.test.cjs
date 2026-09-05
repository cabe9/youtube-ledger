const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('./core.js');
test('daily history combines repeat videos and browsing, hides parked tabs, preserves original data',()=>{
  const make=(id,videoId,foreground,paused,label='Unsorted')=>({id,videoId,title:videoId || 'Browsing YouTube',channel:'stale channel',start:1000,end:2000,label,seconds:{foreground,paused,backgroundAudio:0,backgroundSilent:0,browsing:videoId?0:10,ad:0}});
  const rows=[make('a','v',60,2,'Learning'),make('b','v',30,3),make('parked','v',0,900),make('other','parked',0,500),make('browse1','',0,0),make('browse2','',0,0)];
  const before=JSON.stringify(rows), grouped=Ledger.group(rows);
  assert.equal(grouped.length,2);assert.equal(grouped[0].seconds.foreground,90);assert.equal(grouped[0].seconds.paused,5);assert.equal(grouped[0].label,'Learning');
  assert.equal(grouped[1].seconds.browsing,20);assert.equal(grouped[1].channel,'');assert.equal(JSON.stringify(rows),before);
  rows.push(make('c','v',5,0,'Work'));
  assert.equal(Ledger.group(rows)[0].label,'Mixed');assert.equal(Ledger.group(rows,{'video:v':'Leisure'})[0].label,'Leisure');
});
test('recommendation records persist once, honor pause and delete with the day',async()=>{
  const data={};let listener;
  const extensionURL='moz-extension://test/dashboard.html';
  const sandbox={Ledger,console,browser:{action:{onClicked:{addListener:()=>{}}},tabs:{create:()=>{}},runtime:{getURL:()=>extensionURL,onMessage:{addListener:fn=>listener=fn}},storage:{local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]])),set:async x=>Object.assign(data,x),remove:async keys=>{for(const k of Array.isArray(keys)?keys:[keys]) delete data[k];}}}}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/background.js','utf8'),sandbox);
  const at=new Date(2026,8,4,12).getTime();
  const sender={tab:{id:1,incognito:false},url:'https://www.youtube.com/'};
  const message={type:'recommendation',event:{id:'one',revealId:'r',kind:'reveal',at,page:'/'}};
  await listener(message,sender);await listener(message,sender);
  assert.equal(data['recommendations:2026-09-04'].length,1);
  data.paused=true;
  await listener({...message,event:{...message.event,id:'two'}},sender);
  assert.equal(data['recommendations:2026-09-04'].length,1);
  await listener({type:'clear',day:'2026-09-04'},{tab:{id:2},url:extensionURL});
  assert.equal(data['recommendations:2026-09-04'],undefined);
});
test('wall-clock playback aggregates without converting playback speed to time',()=>{
  const rows=[]; const e={id:'s',start:1000,end:2000,state:'foreground',title:'Video',videoId:'v',url:'https://www.youtube.com/watch?v=v'};
  Ledger.add(rows,e); rows[0].label='Learning'; Ledger.add(rows,{...e,start:2000,end:3000,state:'backgroundAudio'});
  assert.equal(rows.length,1); assert.equal(rows[0].seconds.foreground,1); assert.equal(rows[0].seconds.backgroundAudio,1); assert.equal(rows[0].label,'Learning');
});
test('local midnight splits playback into correct dates',()=>{
  const start=new Date(2026,8,4,23,59,59).getTime(); const parts=Ledger.pieces({start,end:start+2000});
  assert.equal(parts.length,2); assert.equal(parts[0].day,'2026-09-04'); assert.equal(parts[1].day,'2026-09-05'); assert.equal(parts[0].end-parts[0].start,1000);
});
test('invalid durations and sleep gaps do not inflate totals',()=>{
  const rows=[]; for(const end of [NaN,0,-1,6000]) Ledger.add(rows,{id:'s',start:0,end,state:'foreground'});
  assert.equal(rows.length,0);
});
test('content collector distinguishes playback, seeking, background, pause and sleep',()=>{
  let ms=100000, interval, focused=true; const sent=[];
  const video={currentTime:0,paused:false,ended:false,seeking:false,readyState:4,playbackRate:1,muted:false,volume:1};
  const events={};
  const document={visibilityState:'visible',title:'Test - YouTube',hasFocus:()=>focused,querySelector:s=>s==='video'?video:null,addEventListener:(name,fn)=>events[name]=fn};
  const sandbox={URL,crypto:{randomUUID:()=> 'session'},Date:{now:()=>ms},performance:{now:()=>ms},document,location:{href:'https://www.youtube.com/watch?v=test'},window:{addEventListener:(name,fn)=>events[name]=fn},setInterval:fn=>interval=fn,browser:{storage:{local:{get:()=>Promise.resolve({})},onChanged:{addListener:()=>{}}},runtime:{sendMessage:msg=>{sent.push(...msg.events); return Promise.resolve();}}}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/content.js','utf8'),sandbox);
  function step(delta=1,elapsed=1000){ms+=elapsed;video.currentTime+=delta;interval();}
  focused=false;video.paused=true;events.blur();step(0);step(0);events.pagehide();assert.equal(sent.length,0);focused=true;video.paused=false;step(0);sent.length=0;step(); step(100); video.paused=true;step(0);step(0);video.paused=false;focused=false;step(0);step();video.muted=true;step();step();step(100,60000);events.pagehide();
  assert.equal(sent[0].state,'foreground'); assert.equal(sent[1].state,'paused');
  assert.ok(sent.some(e=>e.state==='backgroundAudio')); assert.ok(sent.some(e=>e.state==='backgroundSilent'));
  assert.ok(sent.every(e=>e.end-e.start<=5000));
});
