const fs=require('node:fs'),vm=require('node:vm');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function harness(files=['youtube-requests.js']){
 const clock={now:Date.parse('2026-09-08T03:00:00Z')},data={},session={},timers=new Map();let serial=0;
 const storage=values=>({get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,structuredClone(values[k])])),set:async next=>Object.assign(values,structuredClone(next))});
 const box={URL,Map,Set,Promise,structuredClone,AbortSignal,TextDecoder,crypto:require('node:crypto').webcrypto,
 Date:class extends Date{static now(){return clock.now;}},
 setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:clock.now+ms});return id;},clearTimeout:id=>timers.delete(id),
 browser:{runtime:{getURL:path=>'chrome-extension://test/'+path},tabs:{query:async()=>[{id:1,url:'https://www.youtube.com/',active:false,incognito:false}]},storage:{local:storage(data),session:storage(session)}}};
 vm.createContext(box);const load=file=>vm.runInContext(fs.readFileSync(file,'utf8'),box);files.forEach(load);
 async function tick(){await turn();const next=[...timers.values()].sort((a,b)=>a.at-b.at)[0];if(next){clock.now=next.at;for(const [id,timer] of timers)if(timer.at<=clock.now){timers.delete(id);timer.fn();}await turn();}}
 async function finish(task){let done=false,result,error;Promise.resolve(task).then(value=>{result=value;done=true;},e=>{error=e;done=true;});for(let i=0;i<1000&&!done;i++)await tick();if(!done)throw Error('Request test did not finish');if(error)throw error;return result;}
 const response=(url,status=200,body='',retryAfter)=>({url,ok:status===200,status,headers:{get:()=>retryAfter},text:async()=>body});
 return {box,clock,data,session,load,turn,tick,finish,response};
}
module.exports={harness,turn};
