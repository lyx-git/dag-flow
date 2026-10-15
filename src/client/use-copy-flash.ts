// src/client/use-copy-flash.ts — 复制反馈 hook（2026-10-15 用户拍板：反馈就在按钮本身）
//
// 拍板原话：「不要浮窗，就在按钮本身做，提示已复制」「不用上次的方案」（否掉就地变色方案 A 与浮窗方案 B）。
// 统一模型：点复制 → 按钮文字就地切「✓ 已复制」（成功）/「✗ 复制失败」（失败），1.4s 自动还原回原文案。
// flash 带 key：一个组件里有多个可点目标（如变量 chips、多个参数行）时，只有点中的那个显示提示。
import { useEffect, useRef, useState } from 'react';
import { copyText } from './util/copy-text';

export interface CopyFlashState {
  key: string;
  kind: 'ok' | 'bad';
}

/** 复制 + 按钮文字态。copy(text, key) 后 flash 为 { key, kind }，1.4s 后回到 null */
export function useCopyFlash(): { flash: CopyFlashState | null; copy: (text: string, key?: string) => void } {
  const [flash, setFlash] = useState<CopyFlashState | null>(null);
  const timer = useRef<number | null>(null);
  // 卸载清计时器（避免对已卸载组件 setState）
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const copy = (text: string, key = ''): void => {
    void copyText(text).then((okFlag) => {
      setFlash({ key, kind: okFlag ? 'ok' : 'bad' });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFlash(null), 1400);
    });
  };
  return { flash, copy };
}
