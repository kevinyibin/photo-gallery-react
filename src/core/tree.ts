/**
 * 目录树 —— 构建 / 展开（渲染由 TreePanel 组件完成）。
 */
import { state, notify } from './store';
import type { TreeNode } from './types';

export function buildTree() {
  const root: TreeNode = { name: '全部文件', key: '', children: new Map(), files: 0, images: 0, videos: 0, size: 0, open: true };
  for (const it of state.items) {
    let cur = root;
    cur.files++; cur.size += it.size;
    if (it.kind === 'image') cur.images++; else cur.videos++;
    let acc = '';
    for (const seg of it.path) {
      acc = acc ? acc + '/' + seg : seg;
      if (!cur.children.has(seg)) {
        cur.children.set(seg, { name: seg, key: acc, children: new Map(), files: 0, images: 0, videos: 0, size: 0, open: false });
      }
      cur = cur.children.get(seg)!;
      cur.files++; cur.size += it.size;
      if (it.kind === 'image') cur.images++; else cur.videos++;
    }
  }
  state.tree = root;
  notify('tree');
}

/** 展开到指定目录，便于恢复上次的浏览位置 */
export function openTreePath(dirKey: string) {
  if (!state.tree || !dirKey) return;
  let cur: TreeNode = state.tree;
  cur.open = true;
  for (const seg of dirKey.split('/')) {
    if (!cur.children || !cur.children.has(seg)) break;
    cur = cur.children.get(seg)!;
    cur.open = true;
  }
}

export function hasOpenChild(n: TreeNode): boolean {
  for (const c of n.children.values()) if (c.open) return true;
  return false;
}

export function setOpenAll(n: TreeNode, v: boolean) {
  n.open = v;
  for (const c of n.children.values()) setOpenAll(c, v);
}
