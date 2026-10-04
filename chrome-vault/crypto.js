/* Chrome vault cryptography. Web Crypto only. Manual unlock keeps the private
   key in memory. Browser automatic access and native remembered unlock have
   distinct storage boundaries, disclosed at the point of choice. */
globalThis.LedgerChromeCrypto = (() => {
  const version = 1, iterations = 600000;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
  const rsa = {name:'RSA-OAEP', hash:'SHA-256'};
  const random = length => crypto.getRandomValues(new Uint8Array(length));
  const bytes = value => encoder.encode(value);
  function shape(value, fields) {
    if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).sort().join(',')!==fields.sort().join(',')) throw Error('Unsupported encrypted data fields.');
  }
  function base64(value) {
    const data = new Uint8Array(value), chunks = [];
    for (let i=0; i<data.length; i+=32768) chunks.push(String.fromCharCode(...data.subarray(i,i+32768)));
    return btoa(chunks.join(''));
  }
  function unbase64(value, min = 1, max = 200000) {
    if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4) throw Error('Invalid encrypted data.');
    const raw = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (raw.length < min || raw.length > max || base64(raw) !== value) throw Error('Invalid encrypted data.');
    return raw;
  }
  async function fingerprint(publicKey) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', unbase64(publicKey, 300, 1000))), b => b.toString(16).padStart(2,'0')).join('');
  }
  const aad = (id, purpose) => bytes('ledger-chrome-vault:1:' + id + ':' + purpose);
  async function passwordKey(secret, salt) {
    if (typeof secret !== 'string' || !secret.length || secret.length > 1024) throw Error('Enter a passphrase or recovery key.');
    const material = await crypto.subtle.importKey('raw', bytes(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations}, material, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  }
  async function protect(raw, secret, id, purpose) {
    const salt = random(16), iv = random(12), key = await passwordKey(secret, salt);
    const body = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aad(id,purpose)}, key, raw);
    return {iterations, salt:base64(salt), iv:base64(iv), body:base64(body)};
  }
  function validateWrapper(wrapped) {
    shape(wrapped,['iterations','salt','iv','body']);
    if (wrapped?.iterations !== iterations) throw Error('Unsupported key protection.');
    unbase64(wrapped.salt,16,16); unbase64(wrapped.iv,12,12); unbase64(wrapped.body,1000,4096);
  }
  async function publicKey(config) {
    shape(config,['version','id','publicKey','password','recovery']);
    if (config?.version !== version || !/^[a-f0-9]{64}$/.test(config.id || '') || config.id !== await fingerprint(config.publicKey)) throw Error('Invalid vault identity.');
    validateWrapper(config.password); validateWrapper(config.recovery);
    const key = await crypto.subtle.importKey('spki',unbase64(config.publicKey,300,1000),rsa,false,['wrapKey']);
    if (key.algorithm.modulusLength !== 3072) throw Error('Unsupported public key.');
    return key;
  }
  async function create(passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw Error('Use a passphrase of 12–1,024 characters. Several random words are better.');
    const pair = await crypto.subtle.generateKey({...rsa,modulusLength:3072,publicExponent:new Uint8Array([1,0,1])},true,['wrapKey','unwrapKey']);
    const publicData = base64(await crypto.subtle.exportKey('spki',pair.publicKey));
    const id = await fingerprint(publicData), raw = new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey));
    const recoveryKey = base64(random(32));
    try {
      const password = await protect(raw,passphrase,id,'password');
      const recovery = await protect(raw,recoveryKey,id,'recovery');
      return {config:{version,id,publicKey:publicData,password,recovery},recoveryKey};
    } finally { raw.fill(0); }
  }
  async function unlock(config, secret, recovery = false, session = false) {
    await publicKey(config);
    const purpose = recovery ? 'recovery' : 'password', wrapped = config[purpose];
    let raw;
    try {
      const key = await passwordKey(secret,unbase64(wrapped.salt,16,16));
      raw = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(wrapped.iv,12,12),additionalData:aad(config.id,purpose)},key,unbase64(wrapped.body,1000,4096)));
      const privateKey = await crypto.subtle.importKey('pkcs8',raw,rsa,false,['unwrapKey']);
      // Verify the wrapped private key matches the public recording key, even
      // when a restored vault does not contain any records yet.
      const probe = await seal(config,'00000000-0000-0000-0000-000000000000:1',[]);
      await open(config,privateKey,probe);
      return session ? {privateKey, sessionKey:base64(raw)} : privateKey;
    } catch { throw Error('Could not unlock. Check the passphrase/recovery key, or use an intact backup.'); }
    finally { raw?.fill(0); }
  }
  function validateEnvelope(envelope, config, recordId) {
    shape(envelope,['version','vaultId','recordId','iv','key','body']);
    if (envelope?.version !== version || envelope.vaultId !== config.id || envelope.recordId !== recordId || !/^[\w-]{36}:[1-9][0-9]{0,15}$/.test(recordId)) throw Error('Invalid encrypted record identity.');
    unbase64(envelope.iv,12,12); unbase64(envelope.key,384,384); unbase64(envelope.body,18,33554448);
  }
  async function seal(config, recordId, events) {
    const recipient = await publicKey(config), key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
    const plaintext = bytes(JSON.stringify(events));
    if (plaintext.length > 33554432) throw Error('This encrypted record exceeds 32 MB.');
    const iv = random(12), context = aad(config.id,recordId);
    try {
      const body = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:context},key,plaintext);
      const wrapped = await crypto.subtle.wrapKey('raw',key,recipient,{name:'RSA-OAEP',label:context});
      const envelope = {version,vaultId:config.id,recordId,iv:base64(iv),key:base64(wrapped),body:base64(body)};
      validateEnvelope(envelope,config,recordId); return envelope;
    } finally { plaintext.fill(0); }
  }
  async function open(config, privateKey, envelope) {
    validateEnvelope(envelope,config,envelope.recordId);
    const context = aad(config.id,envelope.recordId);
    const key = await crypto.subtle.unwrapKey('raw',unbase64(envelope.key,384,384),privateKey,{name:'RSA-OAEP',label:context},{name:'AES-GCM',length:256},false,['decrypt']);
    const raw = new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(envelope.iv,12,12),additionalData:context},key,unbase64(envelope.body,18,33554448)));
    try { return JSON.parse(decoder.decode(raw)); } finally { raw.fill(0); }
  }
  async function resume(config, sessionKey) {
    await publicKey(config);
    const raw = unbase64(sessionKey,1000,4096);
    try {const key = await crypto.subtle.importKey('pkcs8',raw,rsa,false,['unwrapKey']);
      await open(config,key,await seal(config,'00000000-0000-0000-0000-000000000000:1',[]));return key;
    } finally {raw.fill(0);}
  }
  async function changePassword(config, secret, next, recovery = false) {
    if (typeof next !== 'string' || next.length < 12 || next.length > 1024) throw Error('Use a passphrase of 12–1,024 characters.');
    const session = await unlock(config,secret,recovery,true), raw = unbase64(session.sessionKey,1000,4096);
    try {return {...config,password:await protect(raw,next,config.id,'password')};}
    finally {raw.fill(0);session.sessionKey='';}
  }
  async function replaceRecovery(config, secret, recovery = false) {
    const session = await unlock(config,secret,recovery,true), raw = unbase64(session.sessionKey,1000,4096), recoveryKey = base64(random(32));
    try {return {config:{...config,recovery:await protect(raw,recoveryKey,config.id,'recovery')},recoveryKey};}
    finally {raw.fill(0);session.sessionKey='';}
  }
  return {create,publicKey,unlock,resume,changePassword,replaceRecovery,seal,open,validateEnvelope};
})();
