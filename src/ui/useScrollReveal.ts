/**
 * 滚动条「滚动时才显示」的行为钩子。
 *
 * 配合 index.css 的 `.scroller` 使用：滚动开始时给容器加上 `is-scrolling`，
 * 停止滚动 idle 毫秒后移除；滑块只在有该类（或指针悬停容器）时着色。
 *
 * 实现方式说明：直接操作 classList 而不走 React state ——
 * 这些容器的 className 是常量字符串，React 不会在后续渲染中重写它，
 * 因此不会被覆盖；同时避免了每次滚动都触发组件重渲染。
 */
import { useEffect, type RefObject } from 'react';

export function useScrollReveal(ref: RefObject<HTMLElement | null>, idle = 800): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      el.classList.add('is-scrolling');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        el.classList.remove('is-scrolling');
      }, idle);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
      el.classList.remove('is-scrolling');
    };
  }, [ref, idle]);
}

export default useScrollReveal;
