const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
require('./core.js');require('./group-icons.js');require('./channel-groups.js');require('./backup.js');
const A='UC'+'a'.repeat(22),V='a'.repeat(11),avatar='https://yt3.googleusercontent.com/channel-picture=s88-c-k-c0x00ffffff-no-rj',url='https://www.youtube.com/channel/'+A;
test('channel portraits come from verified channel metadata and preserve existing images on membership edits',()=>{
 const html=`<link rel="canonical" href="${url}"><meta property="og:title" content="Alpha"><meta property="og:image" content="${avatar}">`;
 const channel=ChannelGroups.parsePage(html,{url});assert.equal(channel.avatarUrl,avatar);
 assert.equal(ChannelGroups.parsePage(html.replace(avatar,'https://evil.test/avatar'),{url}).avatarUrl,undefined);
 assert.throws(()=>ChannelGroups.parsePage(html,{url:url.replace(A,'UC'+'b'.repeat(22))}));
 const video=ChannelGroups.parsePage(html+`<script>var ytInitialPlayerResponse = ${JSON.stringify({videoDetails:{videoId:V,channelId:A,author:'Alpha'}})};</script>`,{url:'https://www.youtube.com/watch?v='+V,videoId:V});assert.equal(video.avatarUrl,undefined,'Video OG images must never become channel portraits');
 const first=ChannelGroups.change(undefined,{action:'create',name:'Podcasts',channel},()=> 'podcasts');
 const second=ChannelGroups.change(first,{action:'create',name:'Learning',channel:{id:A,name:'Alpha'}},()=> 'learning');assert.equal(second.channels[A].avatarUrl,avatar);
});
test('recorded channel media survives aggregation and backups; unsupported image addresses are rejected',()=>{
 const now=Date.now(),rows=[],event={id:'one',videoId:V,title:'A video',channel:'Alpha',url:'https://www.youtube.com/watch?v='+V,start:now-2000,end:now-1000,state:'foreground'};
 Ledger.add(rows,event);Ledger.add(rows,{...event,id:'two',start:now-1000,end:now,channelUrl:url,channelAvatarUrl:avatar});
 assert.equal(Ledger.group(rows)[0].channelAvatarUrl,avatar);
 const data={['day:'+Ledger.dayKey(now)]:rows,'channelGroups:v1':ChannelGroups.change(undefined,{action:'create',name:'Podcasts',channel:{id:A,name:'Alpha',avatarUrl:avatar}},()=> 'podcasts')};
 const backup={format:'youtube-ledger-backup',schemaVersion:1,data};
 assert.deepEqual(LedgerBackup.validate(backup),data);
 for(const bad of ['http://yt3.ggpht.com/a','https://yt3.googleusercontent.com.evil.test/a','https://user:pass@yt3.ggpht.com/a','data:image/png;base64,AA==','https://yt3.ggpht.com:8080/a']){assert.equal(Ledger.avatarURL(bad),'');const copy=structuredClone(backup);copy.data['day:'+Ledger.dayKey(now)][1].channelAvatarUrl=bad;assert.throws(()=>LedgerBackup.validate(copy));}
 const arbitrary=structuredClone(backup);arbitrary.data['channelGroups:v1'].channels[A].avatarUrl='https://evil.test/a';assert.throws(()=>LedgerBackup.validate(arbitrary));
 assert.equal(Ledger.channelURL('https://www.youtube.com/@Alpha/videos'),'');assert.equal(Ledger.channelURL('https://www.youtube.com/@Alpha?x=1'),'https://www.youtube.com/@Alpha');
});
test('portrait enrichment deduplicates, limits concurrency, caches failures and cannot recreate removed channels',async()=>{
 const channels=Object.fromEntries('abcd'.split('').map(c=>{const id='UC'+c.repeat(22);return [id,{id,name:c,url:'https://www.youtube.com/channel/'+id}];}));
 const data={'channelGroups:v1':{version:1,groups:[],channels}};let active=0,peak=0,count=0;
 const box={Ledger,GroupIcons,URL,Date,Map,Set,structuredClone,AbortSignal,browser:{runtime:{getURL:p=>'chrome-extension://ledger/'+p},storage:{local:{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))}}},fetch:async request=>{
  count++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,10));active--;
  if(request.includes('b'.repeat(22)))throw Error('Unavailable');
  if(request.includes('c'.repeat(22)))delete data['channelGroups:v1'].channels['UC'+'c'.repeat(22)];
  return {ok:true,url:request,text:async()=>`<link rel="canonical" href="${request}"><meta property="og:title" content="Channel"><meta property="og:image" content="${avatar}">`};
 }};
 vm.runInNewContext(fs.readFileSync('channel-groups.js','utf8'),box);const sender={url:'chrome-extension://ledger/dashboard.html'},ids=Object.keys(channels),message={type:'channelGroups:portraits',ids};
 await Promise.all([box.ChannelGroups.handle(message,sender),box.ChannelGroups.handle(message,sender)]);
 assert.equal(count,4);assert.equal(peak,2);assert.equal(data['channelGroups:v1'].channels[A].avatarUrl,avatar);assert.ok(data['channelGroups:v1'].channels['UC'+'b'.repeat(22)].avatarCheckedAt);assert.equal(data['channelGroups:v1'].channels['UC'+'c'.repeat(22)],undefined);
 await box.ChannelGroups.handle(message,sender);assert.equal(count,4);
});
