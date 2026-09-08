/* A single accessible undo notice per surface, including modal dialogs. */
globalThis.LedgerUndoUI=(()=>{
  const dispose='ledger-undo-ui-dispose';document.dispatchEvent(new Event(dispose));
  const notices=new Set();
  function show(root,message,token,onUndo){
    if(!root||!token)return;
    for(const notice of notices)if(notice.root===root){notice.node.remove();clearTimeout(notice.timer);notices.delete(notice);}
    const style=document.createElement('style');style.textContent='.ledger-undo{position:sticky;bottom:14px;z-index:10001;display:flex;align-items:center;flex-wrap:wrap;gap:12px;width:fit-content;max-width:100%;margin:16px auto 0;padding:12px 16px;background:var(--panel,#242424);color:var(--ink,#fff);border:1px solid var(--line,#666);border-radius:12px;box-shadow:0 4px 20px #0004;font:14px/1.4 system-ui}.ledger-undo button{font:inherit;border:0;border-radius:5px;padding:6px 8px;cursor:pointer;background:transparent;color:inherit;text-decoration:underline}.ledger-undo button:focus-visible{outline:2px solid currentColor}.ledger-undo p{margin:0}';
    const node=document.createElement('div');node.className='ledger-undo';node.setAttribute('role','status');const text=document.createElement('p');text.textContent=message;
    const action=document.createElement('button');action.type='button';action.textContent='Undo';const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','Dismiss undo');
    const notice={root,node,timer:null};notices.add(notice);const remove=()=>{node.remove();clearTimeout(notice.timer);notices.delete(notice);};
    action.onclick=async()=>{action.disabled=true;try{const result=await browser.runtime.sendMessage({type:'ledger:undo',token});if(!result?.ok)throw Error('Could not undo this change.');await onUndo?.(result);text.textContent='Undone.';action.remove();}catch(error){text.textContent=error.message;action.remove();}};
    dismiss.onclick=remove;node.append(style,text,action,dismiss);(root.querySelector?.('dialog[open]')||root).append(node);
    // Leave ample time for keyboard users; the background token expires after five minutes.
    notice.timer=setTimeout(remove,4*60*1000);node.addEventListener('focusin',()=>clearTimeout(notice.timer));
  }
  document.addEventListener(dispose,()=>{for(const n of notices){n.node.remove();clearTimeout(n.timer);}notices.clear();},{once:true});
  return {show};
})();
