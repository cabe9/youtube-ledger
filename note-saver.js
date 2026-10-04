/* Acknowledged, date-bound drafts. Failed writes remain available for retry. */
globalThis.LedgerNoteSaver = ({send, changed = () => {}, delay = 350}) => {
  const drafts = new Map(); let pending, timer, revision = 0;
  async function flush() {
    clearTimeout(timer);
    if (pending) return pending;
    pending = (async () => {
      while (drafts.size) {
        const [day, draft] = drafts.entries().next().value;
        try {await send(day, draft.value);}
        catch (error) {draft.error = error.message; changed(day, draft); throw error;}
        if (drafts.get(day) === draft) {drafts.delete(day); changed(day, null);}
      }
    })();
    try {await pending;} finally {pending = null;}
  }
  return {
    update(day, value) {
      const draft = {value, revision: ++revision}; drafts.set(day, draft); changed(day, draft);
      clearTimeout(timer); timer = setTimeout(() => void flush().catch(() => {}), delay);
    },
    flush,
    get: day => drafts.get(day),
    discard(from, through) {for(const day of drafts.keys())if(day>=from&&day<=through)drafts.delete(day);},
    get dirty() {return drafts.size > 0;},
    reset() {clearTimeout(timer); drafts.clear();}
  };
};
