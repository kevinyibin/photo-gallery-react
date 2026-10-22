/**
 * Sony RAW（.ARW）联动 —— 与原版本一致：
 * 目录扫描时登记同文件夹的同名 .ARW 文件；索尼拍摄的 JPG 被喜欢 / 删除时联动处理 RAW 原件：
 * - 喜欢：把 ARW 移入同级的「精选RAW」文件夹；
 * - 移入废纸篓：仅做标记（可恢复）；彻底删除时同步删除 ARW 文件。
 */
import { RAW_LIKED_DIR } from './constants';
import { state, notify, setLeft } from './store';
import { writeMeta } from './meta';
import type { MediaItem } from './types';

export interface RawPair {
  name: string;
  handle: FileSystemFileHandle;
  dirKey: string;
}

/** 'dirkey|basename'（全小写）-> RAW 文件登记 */
export const rawIndex = new Map<string, RawPair>();

export function baseOfName(name: string): string {
  const i = name.lastIndexOf('.');
  return (i < 0 ? name : name.slice(0, i)).toLowerCase();
}

export function rawKey(dirKey: string, base: string): string {
  return String(dirKey || '').toLowerCase() + '|' + base;
}

/** 通过 EXIF 的 Make/Model 判断是否为索尼拍摄 */
export function isSony(it: MediaItem | null): boolean {
  const e = it && it.exif;
  if (!e) return false;
  return /sony/i.test(String(e.make || '') + ' ' + String(e.model || ''));
}

export function findRawPair(it: MediaItem | null): RawPair | null {
  if (!it || it.kind !== 'image') return null;
  return rawIndex.get(rawKey(it.dirKey, baseOfName(it.name))) || null;
}

/** 申请目录写入权限（移动 / 删除 RAW 需要 readwrite；须由用户手势触发） */
async function ensureWritePerm(): Promise<boolean> {
  const h = state.rootHandle as any;
  if (!h || !h.requestPermission) return false;
  try {
    if (h.queryPermission && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch (e) { return false; }
}

/** 把 ARW 移入同级新文件夹；返回新文件名，'denied' 无权限，'unsupported' 当前载入方式不支持，null 失败 */
async function moveRawTo(it: MediaItem, pair: RawPair, folderName: string): Promise<string | null> {
  const dirH = state.dirHandles.get(it.dirKey);
  if (!dirH || !pair || !pair.handle) return 'unsupported';
  if (!(await ensureWritePerm())) return 'denied';
  try {
    const target = await dirH.getDirectoryHandle(folderName, { create: true });
    // 目标位置重名时追加序号，避免覆盖已有 RAW
    const dot = pair.name.lastIndexOf('.');
    const base = dot < 0 ? pair.name : pair.name.slice(0, dot);
    const ext = dot < 0 ? '' : pair.name.slice(dot);
    let name = pair.name, n = 1;
    for (;;) {
      try { await target.getFileHandle(name); name = base + ' (' + (n++) + ')' + ext; }
      catch (e) { break; }   // NotFoundError：名字可用
    }
    const fh = await target.getFileHandle(name, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(await pair.handle.getFile());
    await w.close();
    await dirH.removeEntry(pair.name);
    rawIndex.delete(rawKey(pair.dirKey, baseOfName(pair.name)));
    return name;
  } catch (e) { return null; }
}

/** 彻底删除磁盘上的 ARW 原件 */
async function removeRawFile(it: MediaItem, pair: RawPair): Promise<boolean> {
  const dirH = state.dirHandles.get(it.dirKey);
  if (!dirH || !pair || !pair.handle) return false;
  if (!(await ensureWritePerm())) return false;
  try {
    await dirH.removeEntry(pair.name);
    rawIndex.delete(rawKey(pair.dirKey, baseOfName(pair.name)));
    return true;
  } catch (e) { return false; }
}

/** currentItem / 灯箱状态由 preview 模块注入，避免硬循环 */
let getCurrent: () => MediaItem | null = () => null;
export function bindCurrentItemGetter(fn: () => MediaItem | null) { getCurrent = fn; }

function refreshMetaIfCurrent(it: MediaItem) {
  if (getCurrent() === it && state.lbOpen) notify('lightbox');
}

/** 喜欢联动：索尼照片被标记喜欢时，把同名 ARW 移入「精选RAW」文件夹 */
export function bindRawOnLike(it: MediaItem) {
  if (!isSony(it) || it.rawMoved) return;
  const pair = findRawPair(it);
  if (!pair) return;
  moveRawTo(it, pair, RAW_LIKED_DIR).then(res => {
    if (res === 'denied') {
      setLeft('已标记喜欢；移动 RAW 需要文件夹写入权限，已被拒绝');
    } else if (res === 'unsupported') {
      setLeft('已标记喜欢；仅「选择文件夹」浏览模式支持移动 RAW 原件');
    } else if (res) {
      it.rawMoved = 'liked';
      it.rawMovedName = res;   // 记录移动后的文件名（可能因重名加了序号），供取消喜欢时移回
      writeMeta(it);
      setLeft(`已标记喜欢，RAW 原件已移入「${RAW_LIKED_DIR}」：${res}`);
      refreshMetaIfCurrent(it);
    } else {
      setLeft('已标记喜欢；RAW 原件移动失败（文件可能被占用或已移动）');
    }
  });
}

/** 删除联动：移入废纸篓时同步标记 ARW（可恢复）；彻底删除时同步删除 ARW 文件 */
export function bindRawOnTrash(it: MediaItem): boolean {
  if (!isSony(it) || it.rawMoved) return false;
  const pair = findRawPair(it);
  if (!pair) return false;
  it.rawTrash = true;
  writeMeta(it);
  return true;
}

export function bindRawOnRestore(it: MediaItem) {
  if (!it.rawTrash) return;
  it.rawTrash = false;
  writeMeta(it);
}

export function bindRawOnPurge(it: MediaItem) {
  if (!it.rawTrash || !isSony(it)) return;
  const pair = findRawPair(it);
  if (!pair) return;
  removeRawFile(it, pair).then(ok => {
    if (ok) setLeft(`已同步删除 RAW 原件：${pair.name}`);
    else setLeft(`RAW 原件删除失败或需要写入权限：${pair.name}`);
  });
}

/** 详情页文件信息中的 RAW 关联说明 */
export function rawStatusText(it: MediaItem): string {
  if (!isSony(it)) return '';
  if (it.rawMoved === 'liked') return '已移入「' + RAW_LIKED_DIR + '」（喜欢联动，取消喜欢会自动移回）';
  const pair = findRawPair(it);
  if (pair) return pair.name + (it.rawTrash ? '（已随照片标记删除）' : '（已关联，喜欢 / 删除将联动）');
  return '未找到同文件夹下的同名 .ARW 文件';
}

/** 取消喜欢联动：把「精选RAW」里的 ARW 移回原来的文件夹（反向操作） */
export function bindRawOnUnlike(it: MediaItem) {
  if (!isSony(it) || it.rawMoved !== 'liked' || !it.rawMovedName) return;
  moveRawBack(it).then(res => {
    if (res === 'denied') {
      setLeft('已取消喜欢；移回 RAW 需要文件夹写入权限，已被拒绝');
    } else if (res === 'unsupported') {
      setLeft('已取消喜欢；仅「选择文件夹」浏览模式支持移动 RAW 原件');
    } else if (res) {
      it.rawMoved = '';
      it.rawMovedName = '';
      writeMeta(it);
      setLeft(`已取消喜欢，RAW 原件已移回原文件夹：${res}`);
      refreshMetaIfCurrent(it);
    } else {
      setLeft('已取消喜欢；RAW 原件移回失败（文件可能被占用或已不在精选目录）');
    }
  });
}

/** 把已移入「精选RAW」的 ARW 移回原文件夹；返回移回后的文件名，'denied' / 'unsupported' / null 同上 */
async function moveRawBack(it: MediaItem): Promise<string | null> {
  const dirH = state.dirHandles.get(it.dirKey);
  if (!dirH) return 'unsupported';
  if (!(await ensureWritePerm())) return 'denied';
  try {
    const srcDir = await dirH.getDirectoryHandle(RAW_LIKED_DIR);
    const srcFh = await srcDir.getFileHandle(it.rawMovedName);
    const f = await srcFh.getFile();
    // 原位置重名时追加序号，避免覆盖
    const dot = f.name.lastIndexOf('.');
    const base = dot < 0 ? f.name : f.name.slice(0, dot);
    const ext = dot < 0 ? '' : f.name.slice(dot);
    let name = f.name, n = 1;
    for (;;) {
      try { await dirH.getFileHandle(name); name = base + ' (' + (n++) + ')' + ext; }
      catch (e) { break; }   // NotFoundError：名字可用
    }
    const fh = await dirH.getFileHandle(name, { create: true });
    const w = await (fh as any).createWritable();
    await w.write(f);
    await w.close();
    await srcDir.removeEntry(it.rawMovedName);
    // 移回后重新登记索引，恢复后续的喜欢 / 删除联动
    rawIndex.set(rawKey(it.dirKey, baseOfName(name)), { name, handle: fh, dirKey: it.dirKey });
    return name;
  } catch (e) { return null; }
}
