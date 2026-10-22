/**
 * 详情页拍摄信息面板 —— 结构化展示 EXIF，缺失字段显示“未记录”。
 * 数据派生自当前条目；EXIF / 主色调 / 标签变化经 'lightbox' 频道触发重渲染。
 */
import { state, useChannel, notify, setLeft } from '../core/store';
import {
  extOf, fmtSize, fmtDate, fmtDur, fmtF, fmtShutter, fmtEV, fmtExifDate,
  cameraLabel, lensLabel, focalText
} from '../core/utils';
import { familyLabel, familyOfHex } from '../core/colors';
import { rawStatusText } from '../core/rawlink';
import { removeTags, tagsOf } from '../core/meta';
import { askAddTags } from '../core/modal';
import Icon from '../ui/Icon';
import type { MediaItem } from '../core/types';

export default function MetaPanel({ it }: { it: MediaItem }) {
  useChannel('lightbox');
  const e = it.exif;
  const shot = e && e.dateTimeOriginal ? fmtExifDate(e.dateTimeOriginal) : '';
  const sub = [
    cameraLabel(e) || (it.kind === 'video' ? '视频文件' : extOf(it.name).toUpperCase()),
    shot ? shot.split(' ')[0] : ''
  ].filter(Boolean).join(' · ');

  const rows1: [string, string][] = [
    ['相机', cameraLabel(e)],
    ['镜头', lensLabel(e)],
    ['焦距', focalText(e)],
    ['光圈', e && e.fNumber ? 'ƒ/' + fmtF(e.fNumber) : ''],
    ['快门速度', e && e.exposure ? fmtShutter(e.exposure) : ''],
    ['ISO 感光度', e && e.iso ? 'ISO ' + Math.round(e.iso) : ''],
    ['曝光补偿', e && e.exposureBias != null ? fmtEV(e.exposureBias) : ''],
    ['拍摄时间', shot]
  ];
  const rows2: [string, string][] = [
    ['分辨率', (it.w && it.h) ? it.w + ' × ' + it.h + ' px' : ''],
    ['文件格式', extOf(it.name).toUpperCase()],
    ['文件大小', fmtSize(it.size)]
  ];
  if (it.kind === 'video' && it.dur) rows2.push(['时长', fmtDur(it.dur)]);
  const rawTxt = rawStatusText(it);   // 索尼照片：展示同名 ARW 的关联 / 移动状态
  if (rawTxt) rows2.push(['RAW 原件', rawTxt]);
  rows2.push(['所在文件夹', it.dirKey || '根目录']);
  rows2.push(['文件修改时间', fmtDate(it.mtime)]);

  const onRemoveTag = (t: string) => {
    removeTags(it, [t]);
    notify('lightbox', 'grid', 'facets');
    setLeft(`已移除标签「${t}」`);
  };

  return (
    <>
      <div className="mb-1.5">
        <div className="text-[15px] font-[650] leading-[1.45] break-all">{it.name}</div>
        {sub ? <div className="text-xs text-white/55 mt-[3px]">{sub}</div> : null}
      </div>

      {/* 详情页主色调：色卡 + 十六进制值 + 所属色系 */}
      <section>
        <h4 className="my-[18px] mb-1.5 text-[11px] font-semibold text-white/[.48] tracking-[.08em] flex items-center gap-2">{secTitle('主色调')}</h4>
        <PaletteSection it={it} />
      </section>

      {/* 详情页标签：逐个可删，加号按钮打开添加弹窗 */}
      <section>
        <h4 className="my-[18px] mb-1.5 text-[11px] font-semibold text-white/[.48] tracking-[.08em] flex items-center gap-2">{secTitle('标签')}</h4>
        <div className="flex flex-wrap gap-1.5 items-center">
          {tagsOf(it).length
            ? tagsOf(it).map(t => (
                <span className="inline-flex items-center gap-[5px] pl-[9px] pr-1.5 py-[3px] rounded-full bg-white/[.12] text-xs max-w-full" key={t}>
                  {t}
                  <button
                    type="button"
                    className="border-0 bg-transparent cursor-pointer text-white/55 px-0 hover:text-white inline-flex items-center"
                    data-deltag={t}
                    title="移除标签"
                    aria-label={`移除标签 ${t}`}
                    onClick={() => onRemoveTag(t)}
                  ><Icon name="x" size={10} /></button>
                </span>
              ))
            : <span className="text-xs text-white/30">暂无标签</span>}
          <button
            className="h-6 min-w-[26px] px-2 cursor-pointer border border-dashed border-white/30 rounded-full bg-transparent text-white/70 text-xs hover:border-accent hover:text-white hover:bg-white/[.08] inline-flex items-center justify-center"
            id="lmTagAdd"
            title="添加标签"
            aria-label="添加标签"
            onClick={() => askAddTags(it, () => notify('lightbox', 'grid', 'facets'))}
          ><Icon name="plus" size={12} /></button>
        </div>
      </section>

      <MetaSection title="拍摄参数" rows={rows1} />
      <MetaSection title="文件信息" rows={rows2} />
    </>
  );
}

/** 小节标题（右侧自动补齐的分隔线，原为 ::after 伪元素） */
function secTitle(t: string) {
  return (<>{t}<span className="flex-1 h-px bg-white/[.12]"></span></>);
}

function PaletteSection({ it }: { it: MediaItem }) {
  const pal = it.pal || [];
  if (!pal.length) {
    const why = it.kind === 'video' ? '视频未做色彩分析'
      : (it.palDone ? '这张图未能提取主色调'
      : (state.colorEnabled ? '正在分析色彩…' : '色调分析未开启（可在顶栏「设置」中开启）'));
    return <div className="text-xs text-white/30">{why}</div>;
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {pal.map(c => (
          <span className="flex items-center gap-1.5" title={c} key={c}>
            <i className="w-[22px] h-[22px] rounded-md flex-none border border-white/25" style={{ background: c }}></i>
            <em className="not-italic text-[11px] text-white/60 tabular-nums">{c}</em>
          </span>
        ))}
      </div>
      <div className="mt-2 text-xs text-white/[.62]">主色系：<b className="text-white font-semibold">{familyLabel(it.fam || familyOfHex(pal[0]))}</b></div>
    </>
  );
}

function MetaSection({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section>
      <h4 className="my-[18px] mb-1.5 text-[11px] font-semibold text-white/[.48] tracking-[.08em] flex items-center gap-2">{secTitle(title)}</h4>
      {rows.map(([k, v]) => (
        <div className="flex justify-between items-baseline gap-3.5 py-[7px] text-[13px] border-b border-dashed border-white/[.07] last:border-b-0" key={k}>
          <span className="text-white/50 flex-none">{k}</span>
          {v ? <span className="text-right break-words tabular-nums">{v}</span> : <span className="text-right break-words tabular-nums text-white/[.26]">未记录</span>}
        </div>
      ))}
    </section>
  );
}
