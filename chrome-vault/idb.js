/* One IDB transaction per update. Records are encrypted. Opted-in automatic
   access retains a non-extractable CryptoKey in this origin's browser storage. */
globalThis.LedgerVaultIDB = () => {
  let opened;
  const database = () => opened ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('ledger-encrypted-profile-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Another Ledger page is blocking storage. Close it and retry.'));
  });
  async function read(operation) {
    const db = await database(); return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readonly'), request = operation(tx.objectStore('records'));
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  return {get: key => read(store => store.get(key)),
    async entries() {
      const db = await database(); return new Promise((resolve, reject) => {
        const tx = db.transaction('records', 'readonly'), rows = [], request = tx.objectStore('records').openCursor();
        request.onsuccess = () => {const cursor = request.result; if (cursor) {rows.push([cursor.key,cursor.value]); cursor.continue();}};
        tx.oncomplete = () => resolve(rows); tx.onabort = () => reject(tx.error || Error('Storage read was interrupted.'));
      });
    },
    async commit(values, removals = []) {
      const db = await database(); return new Promise((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite', {durability: 'strict'}), store = tx.objectStore('records');
        for (const key of removals) store.delete(key);
        for (const [key, value] of Object.entries(values)) store.put(value, key);
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || Error('Storage write was interrupted.'));
      });
    }};
};
