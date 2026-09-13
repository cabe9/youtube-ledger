// Synthetic uploads only. Never contacts YouTube from the background.
async function seed(){
 const now=Date.now(),day=86400000,A='UC'+'a'.repeat(22),B='UC'+'b'.repeat(22),C='UC'+'c'.repeat(22);
 globalThis.fetch=async()=>{await browser.storage.local.set({'test:unexpected-fetch':true});throw Error('Unexpected YouTube request');};
 const entry=(videoId,channelId,title,age,shorts=false)=>({videoId,channelId,channel:channelId===A?'Quiet creator':'Daily creator',title,publishedAt:now-age,views:{count:1200,checkedAt:now},details:{status:'available',duration:shorts?35:603,shorts,checkedAt:now}});
 const old=entry('old00000001',A,'Last winter’s upload',240*day);
 let cache=GroupFeeds.merge(null,A,[old],now-day);
 cache=GroupFeeds.merge(cache,A,[entry('aaaaaaaaaaa',A,'A familiar voice returns',3*3600000),entry('bbbbbbbbbbb',A,'Learning through conversation',3600000),old],now);
 cache=GroupFeeds.merge(cache,B,[entry('ccccccccccc',B,'A quick language tip',2*3600000,true),entry('ddddddddddd',B,'A hidden upload',4*3600000)],now);
 cache=GroupFeeds.merge(cache,C,[entry('foreign0001',C,'Not in your groups',3600000)],now);
 await browser.storage.local.set({settings:Ledger.settings({backgroundGroupChecks:false,hideRecommendations:false,theme:'retrowave'}),[WatchStatus.key]:{version:1,videos:{bbbbbbbbbbb:{observed:false,segments:[],manual:'watched'}}},
 'groupBrowsing:v1':{version:1,groups:{learn:{hidden:['ddddddddddd']},relax:{hidden:[]}}},
 'channelGroups:v1':{version:1,groups:[{id:'learn',name:'Learn Japanese',channelIds:[A,B],createdAt:now,updatedAt:now},{id:'relax',name:'Listening practice',channelIds:[A],createdAt:now,updatedAt:now}],channels:Object.fromEntries([A,B].map((id,i)=>[id,{id,name:i?'Daily creator':'Quiet creator',url:'https://www.youtube.com/channel/'+id,avatarCheckedAt:now}]))},'channelUploads:v1':cache});
}
async function addLate(){const key='channelUploads:v1',s=await browser.storage.local.get(key),c=s[key].channels['UC'+'a'.repeat(22)];c.entries.push({...c.entries[0],videoId:'late0000001',title:'A late discovery',publishedAt:Date.now()-3*86400000,creatorReturn:undefined});await browser.storage.local.set(s);}
const html=()=>`<!doctype html><style>body{margin:0;background:#100b19;font:14px Arial;color:white}ytd-masthead{display:block;height:56px;padding:16px;box-sizing:border-box}ytd-guide-renderer{display:block;position:fixed;width:230px;top:56px}ytd-page-manager{display:block;margin-left:230px}ytd-browse{display:block}a{color:inherit}@media(max-width:700px){ytd-guide-renderer{display:none}ytd-page-manager{margin-left:0}}</style><ytd-masthead>YouTube · Test fixture</ytd-masthead><ytd-guide-renderer><div id="sections"><a href="/feed/subscriptions">Subscriptions</a></div></ytd-guide-renderer><ytd-page-manager><ytd-browse page-subtype="subscriptions"></ytd-browse></ytd-page-manager>`;
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><defs><linearGradient id="g"><stop stop-color="#60529c"/><stop offset="1" stop-color="#282443"/></linearGradient></defs><rect width="480" height="270" fill="url(#g)"/><circle cx="140" cy="120" r="45" fill="#bb8bcf"/><path d="M0 250 120 140 230 230 340 90 480 230V270H0Z" fill="#7e86b9"/></svg>';
module.exports={seed,addLate,html,svg};
