// Chrome's worker has no DOM. This bundled document only parses inert strings;
// it never navigates, embeds Google, or makes network requests.
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (message?.target!=='ledger-history-parser' || sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('service-worker.js')) return;
  try {respond({value:AccountHistoryParser.google(message.html,message.options)});}
  catch (error) {respond({error:String(error.message || error)});}
});
