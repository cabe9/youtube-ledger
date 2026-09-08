const {test}=require('node:test'),assert=require('node:assert/strict');
require('./core.js');require('./watch-status.js');require('./group-icons.js');require('./channel-groups.js');require('./group-feeds.js');require('./feed-library.js');require('./backup.js');
const A='UC'+'a'.repeat(22),V='a'.repeat(11),W='b'.repeat(11),X='c'.repeat(11),now=Date.now();
const player=(seconds,shorts,extra={})=>({videoDetails:{videoId:V,channelId:A,lengthSeconds:String(seconds)},microformat:{playerMicroformatRenderer:{externalVideoId:V,isShortsEligible:shorts,...extra}}});
test('Shorts classification comes from the matching player, independently of length or title',()=>{
 assert.equal(GroupFeeds.parseVideoDetails(player(150,true),V,A).shorts,true);
 assert.equal(GroupFeeds.parseVideoDetails(player(20,false),V,A).shorts,false);
 assert.equal(GroupFeeds.parseVideoDetails(player(20,undefined),V,A).shorts,'unknown');
 assert.equal(GroupFeeds.parseVideoDetails(player(20,'true'),V,A).shorts,'unknown');
 assert.equal(GroupFeeds.parseVideoDetails(player(20,true,{externalVideoId:W}),V,A).shorts,'unknown');
 assert.throws(()=>GroupFeeds.parseVideoDetails(player(20,true),W,A));
 const cached={status:'available',duration:150,checkedAt:now};
 assert.equal(Ledger.videoDetailsDue(cached,now),false);
 assert.equal(Ledger.videoDetailsDue(cached,now,true),true,'Legacy lengths get classification when requested');
 for(const shorts of [true,false,'unknown'])assert.equal(Ledger.videoDetailsDue({...cached,shorts},now,true),false);
 assert.equal(Ledger.videoDetailsDue({...cached,shorts:'unknown'},now+3600000,true),true,'Unknown results retry with a cooldown');
});
test('Hide Shorts combines with search, sorting and watch filters without hiding ordinary short or unknown uploads',()=>{
 const entries=[{videoId:V,title:'Podcast Short',channel:'Alpha',publishedAt:3,details:GroupFeeds.parseVideoDetails(player(150,true),V,A)},
  {videoId:W,title:'Podcast #shorts (ordinary upload)',channel:'Alpha',publishedAt:2,details:GroupFeeds.parseVideoDetails(player(20,false),V,A)},
  {videoId:X,title:'Podcast unknown',channel:'Alpha',publishedAt:1}];
 const progress={videos:{[W]:{manual:'watched'}}},before=structuredClone({entries,progress});
 const ids=options=>FeedLibrary.visible(entries,progress,{},options).map(e=>e.videoId);
 assert.deepEqual(ids({hideShorts:true}),[W,X]);assert.deepEqual(ids({hideShorts:false}),[V,W,X]);
 assert.deepEqual(ids({hideShorts:true,query:'podcast',sort:'oldest'}),[X,W]);
 assert.deepEqual(ids({hideShorts:true,filter:'unwatched'}),[X]);
 assert.deepEqual(FeedLibrary.visible(entries,progress,{hidden:[V,W]},{hideShorts:true,filter:'hidden'}).map(e=>e.videoId),[W]);
 assert.deepEqual({entries,progress},before);
});
test('The toggle saves per group and survives backup while malformed settings and classification are rejected',()=>{
 const original={version:1,groups:['podcasts','music'].map(id=>({id,name:id,channelIds:[A],createdAt:1,updatedAt:1})),channels:{[A]:{id:A,name:'Alpha',url:'https://www.youtube.com/channel/'+A}}};
 const changed=ChannelGroups.change(original,{action:'shorts',groupId:'podcasts',hideShorts:true});
 assert.equal(changed.groups[0].hideShorts,true);assert.equal(changed.groups[1].hideShorts,undefined);assert.equal(original.groups[0].hideShorts,undefined);
 assert.equal(ChannelGroups.change(changed,{action:'shorts',groupId:'podcasts',hideShorts:false}).groups[0].hideShorts,false);
 assert.throws(()=>ChannelGroups.change(changed,{action:'shorts',groupId:'missing',hideShorts:true}));
 assert.throws(()=>ChannelGroups.change(changed,{action:'shorts',groupId:'podcasts',hideShorts:'true'}));
 const data={'channelGroups:v1':changed,'channelUploads:v1':{version:1,channels:{[A]:{entries:[{videoId:V,channelId:A,channel:'Alpha',title:'Episode',publishedAt:1,details:GroupFeeds.parseVideoDetails(player(150,true),V,A)}]}}}};
 const backup={format:'youtube-ledger-backup',schemaVersion:1,data};assert.deepEqual(LedgerBackup.validate(backup),data);
 const bad=structuredClone(backup);bad.data['channelGroups:v1'].groups[0].hideShorts='yes';assert.throws(()=>LedgerBackup.validate(bad));
 for(const shorts of ['true',null,1,{}])assert.equal(Ledger.validVideoDetails({status:'available',duration:20,checkedAt:now,shorts}),false);
});
