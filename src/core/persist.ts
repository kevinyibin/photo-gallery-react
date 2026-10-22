/**
 * 持久化层 —— IndexedDB 优先，失败降级 localStorage（与原版本行为一致）。
 * 数据库名 / 版本 / 存储键全部沿用，老用户的评分、标签、会话数据可直接复用。
 */
import { DB_NAME, DB_VER, ST_KV, ST_RATE, ST_META, ST_HANDLE } from './constants';

let dbp: Promise<IDBDatabase | null> | null = null;
let dbOk = false;

function openDB(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ST_KV)) db.createObjectStore(ST_KV);
      if (!db.objectStoreNames.contains(ST_RATE)) db.createObjectStore(ST_RATE);
      if (!db.objectStoreNames.contains(ST_META)) db.createObjectStore(ST_META);
      if (!db.objectStoreNames.contains(ST_HANDLE)) db.createObjectStore(ST_HANDLE);
    };
    req.onsuccess = () => { dbOk = true; resolve(req.result); };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}

function idbGet(store: string, key: string): Promise<any> {
  return openDB().then(db => new Promise(resolve => {
    if (!db) return resolve(undefined);
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch (e) { resolve(undefined); }
  }));
}

function idbSet(store: string, key: string, val: any): Promise<boolean> {
  return openDB().then(db => new Promise(resolve => {
    if (!db) return resolve(false);
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) { resolve(false); }
  }));
}

function idbDel(store: string, key: string): Promise<boolean> {
  return openDB().then(db => new Promise(resolve => {
    if (!db) return resolve(false);
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) { resolve(false); }
  }));
}

/**
 * 单事务批量写入：批量打标签时按块调用，避免“一张图一个事务”拖垮大量文件的写入。
 * @returns 完成条数；-1 表示整块事务失败
 */
function idbMany(store: string, pairs: any[][], del?: boolean): Promise<number> {
  return openDB().then(db => new Promise(resolve => {
    if (!db) return resolve(-1);
    try {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      let n = 0;
      tx.oncomplete = () => resolve(n);
      tx.onerror = () => resolve(-1);
      tx.onabort = () => resolve(-1);
      for (let i = 0; i < pairs.length; i++) {
        if (del) os.delete(pairs[i][0]); else os.put(pairs[i][1], pairs[i][0]);
        n++;
      }
    } catch (e) { resolve(-1); }
  }));
}

function idbAll(store: string): Promise<Map<any, any> | null> {
  return openDB().then(db => new Promise(resolve => {
    if (!db) return resolve(null);
    try {
      const out = new Map();
      const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.set(c.key, c.value);
        c.continue();
      };
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  }));
}

function lsRead(store: string): any {
  try { return JSON.parse(localStorage.getItem('lmb:' + store) || 'null'); } catch (e) { return null; }
}

function lsWrite(store: string, key: string, val: any) {
  if (dbOk) return;   // IndexedDB 可用时不写 localStorage，避免占用配额
  try {
    const o = lsRead(store) || {};
    if (val === undefined) delete o[key]; else o[key] = val;
    localStorage.setItem('lmb:' + store, JSON.stringify(o));
  } catch (e) {}
}

export const persist = {
  get(store: string, key: string): Promise<any> {
    return idbGet(store, key).then(v => {
      if (v !== undefined && v !== null) return v;
      const m = lsRead(store);
      return m ? m[key] : undefined;
    }).catch(() => undefined);
  },
  set(store: string, key: string, val: any): Promise<boolean> {
    lsWrite(store, key, val);
    return idbSet(store, key, val);
  },
  del(store: string, key: string): Promise<boolean> {
    lsWrite(store, key, undefined);
    return idbDel(store, key);
  },
  all(store: string): Promise<Map<any, any>> {
    return idbAll(store).then(m => {
      if (m && m.size) return m;
      const o = lsRead(store) || {};
      return new Map(Object.keys(o).map(k => [k, o[k]]));
    }).catch(() => new Map());
  },
  /** 批量写（pairs: [[key, value], ...]），返回完成条数或 -1 */
  setMany(store: string, pairs: any[][]): Promise<number> {
    if (!pairs.length) return Promise.resolve(0);
    if (!dbOk) {
      pairs.forEach(p => lsWrite(store, p[0], p[1]));
      return Promise.resolve(pairs.length);
    }
    return idbMany(store, pairs, false);
  },
  /** 批量删，返回完成条数或 -1 */
  delMany(store: string, keys: string[]): Promise<number> {
    if (!keys.length) return Promise.resolve(0);
    if (!dbOk) {
      keys.forEach(k => lsWrite(store, k, undefined));
      return Promise.resolve(keys.length);
    }
    return idbMany(store, keys.map(k => [k]), true);
  }
};
