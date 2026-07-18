/**
 * 记忆插件 · 面板 UI（按 11 张视觉稿：日夜配色 + 全流程页面）
 * ------------------------------------------------------------
 * 原生 DOM，全部 class 作用域收在 .wrap 下、不污染酒馆。
 * 页面：
 *   hub(01) / 大总结时间轴化内页(05) / 时间轴spine(02) / 档案阅读(03)
 *   / 归档结果窗 通过·软疑·硬错·调试(06/07/08/09) / API 配置(10) / 完整性回退(11)
 * 编辑写回（03 就地改既存档 / 04 结构化）与候选手改（结果窗）均已接。
 */

import {
  MIN_N,
  MIN_SUMMARY_INTERVAL,
  parseArchiveBody,
  serializeContainers,
  type Container,
  type LocatorEntry,
  type ValidationIssue,
} from '../core';
import {
  GenerationCancelledError,
  type ArchiverSession,
  type Candidate,
  type Snapshot,
  type SummaryCandidate,
} from './session';
import { bindPanelCaptureSeal } from './lifecycle';
import type { SummaryPromptId } from './summary-orchestration';

const CSS = `
:host{all:initial;position:fixed !important;inset:0 !important;z-index:2147483600 !important;display:block;}
.wrap{position:absolute;inset:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5;
  --bg:#f6f2e9;--card:#fbf8f1;--ink:#2a251f;--read:#4a4238;--ink2:#564c40;--mut:#a5947c;--faint:#c1b299;
  --acc:#b0774f;--acc-soft:rgba(176,119,79,.10);--line:#e7dcc9;--line2:#efe7d8;--field:#fffdf9;--lock:#c4b7a2;--hollow:#cdbda2;
  --ok:#7c8b5e;--ok-soft:rgba(124,139,94,.12);--warn:#a8904e;--warn-soft:rgba(168,144,78,.13);--err:#a4553f;--err-soft:rgba(164,85,63,.10);}
.wrap.night{--bg:#26221e;--card:#34302a;--ink:#ece5db;--read:#cec4b6;--ink2:#c3b9ab;--mut:#9c9082;--faint:#867a6c;
  --acc:#bda28d;--acc-soft:rgba(189,162,141,.15);--line:#484038;--line2:#3a352e;--field:#2f2b26;--lock:#6f6558;--hollow:#5a5147;
  --ok:#8f9d6d;--ok-soft:rgba(143,157,109,.14);--warn:#a8904e;--warn-soft:rgba(184,154,82,.13);--err:#b06b52;--err-soft:rgba(187,125,100,.13);}
.wrap *{box-sizing:border-box;margin:0;padding:0;}
.wrap .backdrop{position:fixed;inset:0;background:rgba(20,16,12,.46);}
.wrap .daynight{display:inline-flex;border:1px solid var(--line);border-radius:20px;overflow:hidden;background:var(--field);flex:0 0 auto;}
.wrap .dn{font-size:11.5px;color:var(--mut);padding:4px 12px;cursor:pointer;user-select:none;transition:.2s;}
.wrap .dn.on{background:var(--acc);color:#fff;}
.wrap.night .dn.on{color:#26221e;}
.wrap .panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:480px;height:620px;max-width:94vw;max-height:94vh;max-height:94dvh;overflow-y:auto;overflow-x:hidden;
  background:var(--bg);color:var(--ink);border-radius:16px;box-shadow:0 24px 60px -22px rgba(0,0,0,.6);}
.wrap .panel.dragging{user-select:none;-webkit-user-select:none;}
.wrap .panel::-webkit-scrollbar{width:8px;}.wrap .panel::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px;}
.wrap .grow{flex:1;}
.wrap .panel-chrome{position:sticky;top:0;height:0;z-index:30;pointer-events:none;}
.wrap .panel-close{appearance:none;-webkit-appearance:none;position:absolute;top:10px;left:12px;width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:var(--mut);font:300 24px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;pointer-events:auto;touch-action:manipulation;transition:.14s;}
.wrap .panel-close:hover{color:var(--err);background:var(--err-soft);}

/* hub header（sticky：滚动时抬头常驻） */
.wrap .head{display:flex;align-items:center;gap:10px;padding:16px 18px 12px 58px;position:sticky;top:0;z-index:6;background:var(--bg);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;}
.wrap .title{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:20px;font-weight:600;letter-spacing:1.5px;}
.wrap .body{padding:12px 20px 22px;}

/* sub-page header（sticky：滚动时抬头常驻，随内容联动标题） */
.wrap .top{display:flex;align-items:center;gap:10px;padding:14px 18px 12px 58px;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:6;background:var(--bg);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;}
.wrap .panel.dragging .head,.wrap .panel.dragging .top{cursor:grabbing;}
.wrap .back{font-size:17px;color:var(--mut);cursor:pointer;line-height:1;padding:5px 9px 5px 4px;margin:-3px 0;border-radius:8px;user-select:none;flex:0 0 auto;transition:.14s;}
.wrap .back:hover{color:var(--acc);background:var(--acc-soft);}
.wrap .now,.wrap .htitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.wrap .htitle{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:16px;font-weight:600;letter-spacing:.8px;}
.wrap .hmeta{font-size:11px;color:var(--faint);margin-top:5px;}
.wrap .hmeta .ar{color:var(--mut);}

/* hub rects & squares */
.wrap .rect{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:13px;padding:15px 16px;margin-bottom:12px;cursor:pointer;transition:.16s;}
.wrap .rect:hover{border-color:var(--acc);transform:translateY(-1px);box-shadow:0 8px 22px -14px rgba(120,92,60,.5);}
.wrap .rect .mark{width:3px;align-self:stretch;border-radius:3px;background:var(--acc);opacity:.8;flex:0 0 auto;}
.wrap .rect .tx{flex:1;min-width:0;}
.wrap .rect .t{font-size:15px;font-weight:600;letter-spacing:.3px;}
.wrap .rect .d{font-size:11.5px;color:var(--mut);margin-top:3px;}
.wrap .rect .st{font-size:11px;color:var(--ink2);margin-top:7px;}
.wrap .rect .st b{color:var(--acc);font-weight:600;}
.wrap .rect .go{font-size:19px;color:var(--faint);flex:0 0 auto;transition:.16s;}
.wrap .rect:hover .go{color:var(--acc);transform:translateX(2px);}
.wrap .grouplab{font-size:10px;color:var(--faint);letter-spacing:.18em;margin:14px 4px 10px;}
.wrap .squares{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.wrap .sq{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:16px 15px 15px;min-height:120px;display:flex;flex-direction:column;cursor:pointer;transition:.16s;}
.wrap .sq:hover{border-color:var(--acc);transform:translateY(-1px);box-shadow:0 8px 22px -14px rgba(120,92,60,.5);}
.wrap .sqtop{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px;min-height:18px;}
.wrap .sq .dot{width:8px;height:8px;border-radius:50%;background:var(--acc);margin-bottom:11px;}
.wrap .sqtop .dot{margin-bottom:0;}
.wrap .feature-switch{appearance:none;-webkit-appearance:none;position:relative;width:31px;height:18px;flex:0 0 auto;border:1px solid var(--line);border-radius:999px;background:var(--field);cursor:pointer;transition:background .16s,border-color .16s,box-shadow .16s;padding:0;}
.wrap .feature-switch::after{content:"";position:absolute;width:12px;height:12px;left:2px;top:2px;border-radius:50%;background:var(--mut);box-shadow:0 1px 3px rgba(0,0,0,.18);transition:transform .16s,background .16s;}
.wrap .feature-switch[aria-checked="true"]{background:var(--acc);border-color:var(--acc);}
.wrap .feature-switch[aria-checked="true"]::after{background:#fff;transform:translateX(13px);}
.wrap.night .feature-switch[aria-checked="true"]::after{background:#26221e;}
.wrap .feature-switch:hover{box-shadow:0 0 0 3px var(--acc-soft);}
.wrap .feature-switch:focus-visible{outline:2px solid var(--acc);outline-offset:2px;}
.wrap .sq .t{font-size:14px;font-weight:600;letter-spacing:.3px;}
.wrap .updot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--warn);box-shadow:0 0 0 3px var(--warn-soft);margin-left:7px;vertical-align:1px;}
.wrap .sq .d{font-size:11px;color:var(--mut);margin-top:5px;line-height:1.6;}
.wrap .sq .sp{flex:1;}
.wrap .sq .stat{font-size:11px;color:var(--ink2);}
.wrap .sq .stat b{color:var(--acc);font-weight:600;}
.wrap .sq .stat.disabled{color:var(--mut);}
.wrap .sq .stat.due{display:flex;align-items:center;gap:6px;color:var(--acc);font-weight:500;}
.wrap .sq .stat.due .pin{width:6px;height:6px;border-radius:50%;background:var(--acc);box-shadow:0 0 0 3px var(--acc-soft);flex:0 0 auto;}
.wrap .sq.tbd{background:transparent;border-style:dashed;cursor:default;}
.wrap .sq.tbd:hover{transform:none;box-shadow:none;border-color:var(--line);}
.wrap .sq.tbd .dot{background:transparent;border:2px solid var(--faint);}
.wrap .sq.tbd .t,.wrap .sq.tbd .d,.wrap .sq.tbd .foot{color:var(--mut);}
.wrap .foot{font-size:10.5px;color:var(--faint);}
.wrap .warnbar{display:flex;align-items:center;gap:8px;background:var(--warn-soft);border:1px solid var(--warn);color:var(--warn);border-radius:11px;padding:11px 13px;margin-bottom:12px;font-size:12px;cursor:pointer;}
.wrap .okbar{background:var(--ok-soft);border-color:var(--ok);color:var(--ok);cursor:default;}
.wrap .empty{color:var(--faint);font-size:12px;text-align:center;padding:26px 0;}

/* 05 archive setup */
.wrap .runbtn{width:100%;border:0;border-radius:12px;background:var(--acc);color:#fff;font:inherit;font-size:14.5px;font-weight:600;padding:14px;cursor:pointer;letter-spacing:1px;transition:.14s;}
.wrap.night .runbtn{color:#26221e;}
.wrap .runbtn:hover{filter:brightness(1.05);}
.wrap .runbtn.off{opacity:.5;cursor:not-allowed;}
.wrap .setwrap{margin:20px 0 8px;}
.wrap .setrow{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink);}
.wrap .num{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:8px;background:var(--field);overflow:hidden;}
.wrap .num button{border:0;background:transparent;color:var(--mut);font:inherit;font-size:15px;width:28px;height:30px;cursor:pointer;}
.wrap .num button:hover{color:var(--acc);}
.wrap .num input{width:48px;border:0;outline:0;background:transparent;text-align:center;font:inherit;font-size:13px;color:var(--ink);}
.wrap .subhint{font-size:10.5px;color:var(--faint);margin:8px 2px 0;}
.wrap .seclab{font-size:10px;color:var(--faint);letter-spacing:.14em;text-transform:uppercase;margin:22px 2px 11px;}
.wrap .promptsec{display:flex;align-items:center;gap:8px;margin:22px 2px 11px;min-height:22px;flex-wrap:wrap;}
.wrap .promptsec .seclab{margin:0;flex:0 0 auto;}
.wrap .promptcontrols{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;}
.wrap .promptfollow{font-size:10.5px;color:var(--faint);white-space:nowrap;flex:0 0 auto;}
.wrap .promptnotice{font-size:10.5px;color:var(--warn);white-space:nowrap;flex:0 0 auto;}
.wrap .promptreset{font-size:10.5px;color:var(--acc);border:1px solid var(--acc);border-radius:7px;padding:3px 8px;cursor:pointer;white-space:nowrap;transition:.14s;flex:0 0 auto;}
.wrap .promptreset:hover{background:var(--acc-soft);}
.wrap .mods{display:flex;flex-direction:column;gap:7px;}
.wrap .mod{border:1px solid var(--line);border-radius:8px;background:var(--card);overflow:hidden;}
.wrap .mod.ro{border-style:dashed;}
.wrap .modhead{display:flex;align-items:center;gap:8px;padding:6px 10px;min-height:34px;cursor:pointer;flex-wrap:wrap;}
.wrap .mt{font-size:13px;font-weight:500;}
.wrap .prompttag{font-size:9.5px;color:var(--faint);border:1px solid var(--line);border-radius:5px;padding:1px 6px;white-space:nowrap;}
.wrap .prompttag.custom{color:var(--acc);border-color:var(--acc);}
.wrap .prompttag.update{color:var(--warn);border-color:var(--warn);background:var(--warn-soft);}
.wrap .rotag{font-size:10px;color:var(--faint);border:1px solid var(--line);border-radius:5px;padding:1px 6px;}
.wrap .pen{font-size:13px;color:var(--mut);padding:2px 5px;border-radius:6px;transition:.14s;}
.wrap .pen:hover{color:var(--acc);background:var(--acc-soft);}
.wrap .pen.active{color:var(--acc);background:var(--acc-soft);}
.wrap .modedit{padding:0 9px 8px;}
.wrap .msub{font-size:10px;color:var(--faint);margin:9px 0 4px;display:flex;align-items:center;gap:8px;}
.wrap .msub .fullbtn{margin-left:auto;}
.wrap .fullbtn{color:var(--mut);cursor:pointer;font-size:11px;padding:1px 6px;border:1px solid var(--line);border-radius:5px;transition:.14s;flex:0 0 auto;user-select:none;}
.wrap .fullbtn:hover{color:var(--acc);border-color:var(--acc);}
.wrap .mod-actions{display:inline-flex;align-items:center;justify-content:flex-end;gap:8px;flex:0 0 auto;min-width:0;}
.wrap .ebar .fullbtn{margin-right:auto;}
.wrap .modedit textarea{width:100%;height:62px;min-height:46px;resize:vertical;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--read);font:inherit;font-size:12px;line-height:1.6;padding:7px 9px;outline:0;}
.wrap .modedit textarea:focus{border-color:var(--acc);}
.wrap .runtime-summary{font-size:11px;line-height:1.65;color:var(--mut);background:var(--field);border:1px dashed var(--line);border-radius:7px;padding:7px 9px;}
.wrap .runtime-summary b{color:var(--read);font-weight:500;}
.wrap .debug-stack{display:flex;flex-direction:column;gap:8px;}
.wrap .debug-stack .runtime-summary:not(:first-child){margin-top:8px;}
.wrap .debug-empty{color:var(--faint);font-style:italic;}
.wrap .prompt-global-note{font-size:10.5px;color:var(--faint);margin:-4px 2px 10px;line-height:1.6;}
.wrap .prompt-update-card{margin:8px 0 1px;padding:10px 11px;border:1px solid var(--warn);border-radius:9px;background:var(--warn-soft);}
.wrap .prompt-update-title{font-size:11.5px;color:var(--warn);font-weight:600;}
.wrap .prompt-update-copy{font-size:10.5px;color:var(--mut);line-height:1.65;margin-top:3px;}
.wrap .prompt-update-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:9px;}
.wrap .prompt-action{appearance:none;-webkit-appearance:none;border:1px solid var(--line);border-radius:7px;background:var(--field);color:var(--ink2);font:inherit;font-size:10.5px;line-height:1.25;padding:6px 9px;cursor:pointer;transition:.14s;white-space:normal;text-align:center;}
.wrap .prompt-action:hover{border-color:var(--acc);color:var(--acc);background:var(--acc-soft);}
.wrap .prompt-action.keep{border-color:var(--warn);color:var(--warn);}
.wrap .prompt-action.use{border-color:var(--acc);color:var(--acc);font-weight:600;}
.wrap .prompt-compare{padding:14px 18px 18px;display:flex;flex-direction:column;gap:12px;flex:1 1 auto;min-height:0;overflow:auto;}
.wrap .compare-intro{font-size:11px;line-height:1.7;color:var(--mut);padding:9px 11px;border-radius:9px;background:var(--warn-soft);border:1px solid var(--warn);}
.wrap .compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;min-height:0;flex:1 1 auto;}
.wrap .compare-pane{display:flex;flex-direction:column;min-width:0;min-height:220px;border:1px solid var(--line);border-radius:10px;background:var(--card);overflow:hidden;}
.wrap .compare-label{font-size:11px;color:var(--mut);padding:8px 11px;border-bottom:1px solid var(--line);background:var(--bg);}
.wrap .compare-label b{color:var(--ink);font-weight:600;}
.wrap .compare-text{padding:12px 13px;white-space:pre-wrap;overflow:auto;overflow-wrap:anywhere;word-break:break-word;color:var(--read);font:12px/1.75 -apple-system,"PingFang SC",sans-serif;flex:1 1 auto;}
.wrap .compare-footer{display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap;}
@media (max-width:640px){
  .wrap .top>.htitle{flex:1 1 0;}
  .wrap .top>.htitle~.grow{display:none;}
  .wrap .daynight .dn{padding:4px 8px;}
  .wrap .promptsec>.grow{display:none;}
  .wrap .promptcontrols{width:100%;flex:1 0 100%;justify-content:flex-end;flex-wrap:wrap;}
  .wrap .promptcontrols .promptnotice{margin-right:auto;}
  .wrap .mod-actions{width:100%;flex:1 0 100%;padding-top:3px;}
  .wrap .prompt-update-actions{display:grid;grid-template-columns:1fr;}
  .wrap .prompt-action{width:100%;padding:8px 9px;}
  .wrap .compare-grid{grid-template-columns:1fr;}
  .wrap .compare-pane{min-height:180px;}
}
.wrap .headact{font-size:10.5px;color:var(--mut);cursor:pointer;padding:1px 3px;white-space:nowrap;}
.wrap .headact.saveact{color:var(--acc);font-weight:600;}
/* 提示词全屏编辑：面板放大、大文本框铺满（用 vh 定高，避开百分比高度链断裂） */
.wrap .panel.full{width:min(900px,calc(100vw - 32px));height:calc(100vh - 40px);height:calc(100dvh - 40px);max-width:none;max-height:900px;overflow:hidden;}
.wrap .panel.full [data-el=view]{height:100%;min-height:0;display:flex;flex-direction:column;}
.wrap .panel.full .top{flex:0 0 auto;}
.wrap .full-update-slot{padding:10px 18px 0;flex:0 0 auto;}
.wrap .full-update-slot .prompt-update-card{margin:0;}
.wrap .fullwrap{padding:14px 18px 18px;flex:1 1 auto;min-height:0;}
.wrap .fulltext{width:100%;height:100%;resize:none;border:1px solid var(--line);border-radius:10px;background:var(--field);color:var(--read);font:13px/1.85 -apple-system,"PingFang SC",sans-serif;padding:14px 16px;outline:0;}
.wrap .fulltext:focus{border-color:var(--acc);}
.wrap .top .savem{cursor:pointer;color:var(--acc);font-weight:600;font-size:13px;flex:0 0 auto;}
.wrap .modedit textarea[readonly]{color:var(--mut);cursor:default;}
.wrap .ebar{display:flex;gap:16px;justify-content:flex-end;align-items:center;margin-top:10px;}
.wrap .ebar .cancel{font-size:12px;color:var(--mut);cursor:pointer;}
.wrap .ebar .savem{font-size:12px;color:var(--acc);font-weight:600;cursor:pointer;}
.wrap .robox{font-size:11px;color:var(--mut);line-height:1.7;padding:10px 12px;border:1px dashed var(--line);border-radius:9px;background:var(--field);margin-top:8px;}
.wrap .rangebox{margin:13px 0 2px;border:1px solid var(--line);border-radius:9px;background:var(--card);overflow:hidden;}
.wrap .rangehead{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--line);font-size:11px;color:var(--mut);}
.wrap .rangehead b{color:var(--ink);font-size:11.5px;}
.wrap .rangectl{color:var(--acc);cursor:pointer;font-size:10.5px;}
.wrap .rangeitems{max-height:112px;overflow:auto;padding:3px 7px;}
.wrap .rangeitem{display:flex;align-items:center;gap:8px;padding:4px 3px;font-size:11px;color:var(--read);cursor:pointer;}
.wrap .rangeitem input{accent-color:var(--acc);width:13px;height:13px;flex:0 0 auto;}
.wrap .rangeitem .rfloor{font-family:"SF Mono",Menlo,monospace;color:var(--acc);min-width:42px;}
.wrap .rangeitem .rtitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* 02 timeline spine */
.wrap .metarow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px;}
.wrap .meta{font-size:11px;color:var(--mut);}
.wrap .rettoggle{font-size:10.5px;color:var(--faint);cursor:pointer;border:1px solid var(--line);border-radius:20px;padding:3px 11px;transition:.14s;flex:0 0 auto;user-select:none;}
.wrap .rettoggle:hover{color:var(--acc);border-color:var(--acc);}
.wrap .spine{position:relative;border-left:2px solid var(--line);margin-left:6px;padding-left:20px;}
.wrap .ev{position:relative;}
.wrap .ev .card{scroll-margin-top:58px;}
.wrap .read [data-cidx]{scroll-margin-top:58px;}
/* 底部留白：让靠近末尾的容器也能滚到抬头正下方（返回定位/落点定位用） */
.wrap .scrollpad{height:500px;flex:0 0 auto;pointer-events:none;}
.wrap .ev .edot{position:absolute;left:-21px;top:15px;width:10px;height:10px;border-radius:50%;background:var(--acc);transform:translateX(-50%);z-index:2;}
.wrap .ev .edot.hollow{background:var(--bg);border:2px solid var(--hollow);}
.wrap .ev .card{padding:11px 13px;border-radius:11px;cursor:pointer;background:transparent;box-shadow:0 0 0 rgba(0,0,0,0);transform:translateY(0);transition:background .16s ease,box-shadow .18s ease,transform .18s ease;margin-bottom:9px;}
/* 同色浮起：悬停不改背景色（与面板同 --bg），只靠阴影+轻微上浮显层次 */
.wrap .ev:hover .card{background:var(--bg);box-shadow:0 5px 16px -9px rgba(120,92,60,.3);transform:translateY(-1px);}
.wrap.night .ev:hover .card{box-shadow:0 7px 20px -10px rgba(0,0,0,.62);}
.wrap .ev.retired .yr,.wrap .ev.retired .nm{opacity:.5;}
.wrap .ev .yr{font-size:10.5px;color:var(--mut);margin-bottom:3px;letter-spacing:.05em;}
.wrap .ev .nm{font-size:14px;color:var(--ink);}
.wrap .refresh{font-size:11px;color:var(--faint);}

/* 03 archive reading */
.wrap .now{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:14.5px;font-weight:600;letter-spacing:.6px;}
.wrap .now small{font-family:-apple-system,sans-serif;font-weight:400;font-size:10.5px;color:var(--mut);margin-left:7px;}
.wrap .read{padding:16px 18px 20px;}
.wrap .chead .cline{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}
.wrap .cyr{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:13px;color:var(--acc);}
.wrap .cname{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:16px;font-weight:600;letter-spacing:.5px;}
.wrap .crange{font-size:10.5px;color:var(--faint);margin:5px 0 10px;}
.wrap .prose{font-size:13px;line-height:1.95;color:var(--read);text-align:justify;}
.wrap .prose p{margin-bottom:10px;}.wrap .prose p:last-child{margin-bottom:0;}
.wrap .dftitle{font-size:12.5px;color:var(--acc);font-weight:600;margin:13px 0 4px;}
.wrap .dsmall{font-size:12.5px;color:var(--read);line-height:1.85;margin-bottom:6px;}
.wrap .dexc{font-size:12px;color:var(--mut);line-height:1.8;padding-left:14px;text-indent:-11px;}
.wrap .dexc .d{color:var(--acc);}
.wrap .readnote{margin:16px 0 0;font-size:10.5px;color:var(--faint);text-align:center;}
.wrap .badge{margin-left:8px;font-size:10px;color:var(--acc);border:1px solid var(--acc);border-radius:20px;padding:2px 8px;flex:0 0 auto;}
.wrap .rcont{border-radius:12px;}
.wrap .rcont.editable{cursor:pointer;padding:12px;margin:-4px;transition:background .16s,box-shadow .18s,transform .18s;}
.wrap .rcont.editable:hover{background:var(--card);box-shadow:0 6px 18px -10px rgba(0,0,0,.35);transform:translateY(-1px);}
.wrap .ebar .tip{margin-right:auto;font-size:10.5px;color:var(--faint);}
/* 容器间分隔 ◇（往下滑到下一个） */
.wrap .sep{display:flex;align-items:center;justify-content:center;margin:16px 0;color:var(--faint);}
.wrap .sep::before,.wrap .sep::after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,var(--line),transparent);}
.wrap .sep .d{font-size:9px;letter-spacing:4px;padding:0 8px;}
/* 04 结构化编辑：灰色=锁定结构，有底框才可改 */
.wrap .selegend{font-size:10.5px;color:var(--faint);line-height:1.7;margin-bottom:12px;padding:9px 11px;background:var(--acc-soft);border-radius:8px;}
.wrap .selegend .lk{color:var(--lock);}
.wrap .selegend .ed{color:var(--acc);border-bottom:1px solid var(--acc);}
.wrap .se-root{padding:2px;}
.wrap .tok{color:var(--lock);user-select:none;}
.wrap .f{background:var(--field);border:1px solid var(--line);border-radius:6px;padding:2px 8px;outline:0;color:var(--ink);display:inline-block;min-width:40px;transition:.14s;white-space:pre-wrap;}
.wrap .f:focus{border-color:var(--acc);}
.wrap .fblock{display:block;background:var(--field);border:1px solid var(--line);border-radius:8px;padding:10px 11px;outline:0;color:var(--read);font-size:12.5px;line-height:1.85;margin:8px 0 4px;text-align:justify;white-space:pre-wrap;}
.wrap .fblock:focus{border-color:var(--acc);}
.wrap .se-ctitle{font-family:"Songti SC","Noto Serif CJK SC",serif;font-size:15px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;}
.wrap .se-ctitle .f{font-family:"Songti SC","Noto Serif CJK SC",serif;font-weight:600;}
.wrap .se-ctitle .f.time,.wrap .se-ftitle .f.time{font-family:-apple-system,sans-serif;font-weight:400;font-size:11px;color:var(--mut);}
.wrap .se-ftitle{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:16px 0 2px;font-size:13px;}
.wrap .se-exc{display:flex;align-items:flex-start;gap:7px;margin:7px 0;}
.wrap .se-exc .star{color:var(--lock);padding-top:3px;user-select:none;font-size:14px;}
.wrap .se-exc .f.line{flex:1;font-size:12px;line-height:1.7;padding:5px 9px;}
.wrap .se-exc .del{color:var(--faint);cursor:pointer;font-size:13px;padding:3px 6px;border-radius:5px;}
.wrap .se-exc .del:hover{color:var(--err);background:var(--err-soft);}
.wrap .excadd{font-size:11px;color:var(--faint);margin-left:22px;cursor:pointer;display:inline-block;margin-top:2px;}
.wrap .excadd:hover{color:var(--acc);}
.wrap .editbar2{display:flex;align-items:center;gap:18px;justify-content:flex-end;margin-top:16px;padding-top:12px;border-top:1px solid var(--line);}
.wrap .editbar2 .cancel{font-size:12px;color:var(--mut);cursor:pointer;}
.wrap .editbar2 .savem{font-size:12px;color:var(--acc);font-weight:600;cursor:pointer;}
.wrap .editing-card{background:var(--field);border:1px solid var(--line);border-radius:12px;padding:14px 15px;}

/* result window (06/07/08/09) */
.wrap .panel.result{overflow:hidden;}
.wrap .panel.result [data-el=view]{height:100%;min-height:0;}
.wrap .result-page{height:100%;min-height:0;display:flex;flex-direction:column;}
.wrap .result-fixed{flex:0 0 auto;background:var(--bg);z-index:2;}
.wrap .result-title{min-width:0;}
.wrap .result-status{padding:10px 20px 0;}
.wrap .result-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 20px 16px;}
.wrap .result-scroll::-webkit-scrollbar{width:8px;}.wrap .result-scroll::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px;}
.wrap .result-footer{flex:0 0 auto;padding:10px 20px 14px;border-top:1px solid var(--line);background:var(--bg);}
.wrap .result-footer .acts{margin-top:0;}
.wrap .repairrow{display:flex;justify-content:flex-end;margin:-4px 0 10px;}
.wrap .repairbtn{border:1px solid var(--err);background:var(--err-soft);color:var(--err);font:inherit;font-size:11.5px;padding:6px 10px;border-radius:8px;cursor:pointer;}
.wrap .discard{font-size:12px;color:var(--mut);cursor:pointer;padding:5px 8px;border-radius:7px;transition:.14s;}
.wrap .discard:hover{color:var(--err);background:var(--err-soft);}
.wrap .verify{display:flex;align-items:center;gap:9px;padding:11px 13px;border-radius:10px;margin-bottom:13px;font-size:12.5px;}
.wrap .verify .mk{width:19px;height:19px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 auto;}
.wrap .verify.ok{background:var(--ok-soft);border:1px solid var(--ok);}.wrap .verify.ok .mk{background:var(--ok);}.wrap .verify.ok .vt{color:var(--ok);}
.wrap .verify.soft{background:var(--warn-soft);border:1px solid var(--warn);}.wrap .verify.soft .mk{background:var(--warn);}.wrap .verify.soft .vt{color:var(--warn);}
.wrap .verify.hard{background:var(--err-soft);border:1px solid var(--err);}.wrap .verify.hard .mk{background:var(--err);}.wrap .verify.hard .vt{color:var(--err);}
.wrap .verify .vt{font-weight:500;flex:1;}
.wrap .verify .vs{font-size:11px;color:var(--mut);}
.wrap .issues{display:flex;flex-direction:column;gap:8px;margin-bottom:14px;}
.wrap .iss{display:flex;gap:10px;align-items:flex-start;padding:11px 13px;border-radius:10px;}
.wrap .iss.soft{background:var(--warn-soft);border:1px solid var(--warn);}
.wrap .iss.hard{background:var(--err-soft);border:1px solid var(--err);}
.wrap .iss .ic{width:17px;height:17px;border-radius:50%;color:#fff;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:11px;margin-top:1px;}
.wrap .iss.soft .ic{background:var(--warn);}.wrap .iss.hard .ic{background:var(--err);}
.wrap .iss .itxt{flex:1;min-width:0;}
.wrap .iss .loc{font-size:12px;font-weight:600;margin-bottom:3px;}
.wrap .iss.soft .loc{color:var(--warn);}.wrap .iss.hard .loc{color:var(--err);}
.wrap .iss .desc{font-size:11.5px;color:var(--read);line-height:1.6;}
.wrap .iss .sug{font-size:11px;margin-top:4px;}
.wrap .iss.soft .sug{color:var(--warn);}.wrap .iss.hard .sug{color:var(--err);}
.wrap .cand-head{display:flex;align-items:center;gap:10px;margin-bottom:9px;}
.wrap .seg{display:inline-flex;border:1px solid var(--line);border-radius:9px;background:var(--field);padding:2px;gap:2px;}
.wrap .seg button{border:0;background:transparent;font:inherit;font-size:11.5px;color:var(--mut);padding:5px 12px;border-radius:7px;cursor:pointer;transition:.14s;}
.wrap .seg button.on{background:var(--acc);color:#fff;}
.wrap.night .seg button.on{color:#26221e;}
.wrap .edit-cue{font-size:10.5px;color:var(--faint);margin-left:auto;}
.wrap .doc{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:15px 16px;max-height:290px;overflow:auto;cursor:text;transition:.14s;}
.wrap .result-scroll .doc{max-height:none;overflow:visible;}
.wrap .doc:hover{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft);}
.wrap .doc::-webkit-scrollbar{width:8px;}.wrap .doc::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px;}
.wrap .shell{font-size:10.5px;color:var(--faint);font-family:"SF Mono",Menlo,monospace;}
.wrap .ctitle{font-family:"Songti SC","Noto Serif CJK SC",Georgia,serif;font-size:14.5px;font-weight:600;margin:12px 0 6px;letter-spacing:.3px;}
.wrap .ctitle:first-of-type{margin-top:7px;}
.wrap .big{font-size:12.5px;color:var(--read);line-height:1.9;margin-bottom:9px;}
.wrap .ftitle{font-size:12px;color:var(--acc);font-weight:600;margin:9px 0 4px;}
.wrap .small{font-size:12px;color:var(--read);line-height:1.85;margin-bottom:6px;}
.wrap .exc{font-size:11.5px;color:var(--mut);line-height:1.8;padding-left:13px;text-indent:-11px;}
.wrap .exc .d{color:var(--acc);}
.wrap .raw{white-space:pre-wrap;word-break:break-word;font:12px/1.7 "SF Mono",Menlo,monospace;color:var(--read);}
.wrap .editdoc{width:100%;min-height:220px;resize:vertical;border:1px solid var(--acc);border-radius:11px;background:var(--field);color:var(--read);font:12.5px/1.85 -apple-system,"PingFang SC",sans-serif;padding:14px 15px;outline:0;}
.wrap .guide{margin:15px 0 4px;}
.wrap .glab{font-size:10.5px;color:var(--faint);margin:0 2px 6px;}
.wrap .glab b{color:var(--mut);}
.wrap .guide input{width:100%;border:1px solid var(--line);border-radius:9px;background:var(--field);color:var(--read);font:inherit;font-size:12px;padding:10px 12px;outline:0;}
.wrap .guide input:focus{border-color:var(--acc);}
.wrap .acts{display:flex;align-items:center;gap:9px;margin-top:16px;}
.wrap .ghost{border:1px solid var(--line);background:var(--card);color:var(--read);font:inherit;font-size:12.5px;padding:11px 16px;border-radius:10px;cursor:pointer;transition:.14s;}
.wrap .ghost:hover{border-color:var(--acc);color:var(--acc);}
.wrap .savenote{margin-left:auto;font-size:10.5px;margin-right:2px;}
.wrap .savenote.soft{color:var(--warn);}.wrap .savenote.hard{color:var(--err);}
.wrap .save{border:0;background:var(--acc);color:#fff;font:inherit;font-size:13px;font-weight:600;padding:12px 26px;border-radius:10px;cursor:pointer;letter-spacing:1px;transition:.14s;}
.wrap.night .save{color:#26221e;}
.wrap .save.off{background:var(--line);color:var(--faint);cursor:not-allowed;}
.wrap .acts .save:first-child{margin-left:auto;}

/* 10 API config */
.wrap .api-section+.api-section{margin-top:22px;padding-top:20px;border-top:1px solid var(--line);}
.wrap .fnname{font-size:14.5px;font-weight:600;letter-spacing:.3px;margin-bottom:12px;}
.wrap .flabel{font-size:12px;color:var(--read);margin-bottom:8px;}
.wrap .sel{position:relative;}
.wrap .sel select{width:100%;appearance:none;-webkit-appearance:none;border:1px solid var(--line);border-radius:10px;background:var(--field);color:var(--ink);font:inherit;font-size:13px;padding:12px 38px 12px 14px;cursor:pointer;outline:0;}
.wrap .sel select:focus{border-color:var(--acc);}
.wrap .sel .chev{position:absolute;right:15px;top:50%;transform:translateY(-50%);color:var(--mut);pointer-events:none;font-size:11px;}
.wrap .apirow{display:flex;align-items:stretch;gap:9px;}
.wrap .apirow .sel{flex:1;min-width:0;}
.wrap .api-save{flex:0 0 auto;min-width:56px;padding:0 15px;letter-spacing:.3px;}
.wrap .modelhint{font-size:11.5px;color:var(--mut);margin:20px 2px 0;line-height:1.7;}

/* 11 integrity */
.wrap .imk{width:26px;height:26px;border-radius:50%;background:var(--err-soft);border:1px solid var(--err);color:var(--err);display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 auto;margin-top:1px;}
.wrap .hsub{font-size:11px;color:var(--err);margin-top:4px;line-height:1.5;}
.wrap .list{display:flex;flex-direction:column;gap:7px;}
.wrap .item{display:flex;align-items:center;gap:11px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);}
.wrap .item .itx{flex:1;min-width:0;}
.wrap .item .nm{font-size:13.5px;color:var(--ink);}
.wrap .item .src{font-size:10.5px;color:var(--mut);margin-top:2px;font-family:"SF Mono",Menlo,monospace;}
.wrap .item .old{font-size:9.5px;color:var(--err);border:1px solid var(--err);border-radius:5px;padding:1px 6px;white-space:nowrap;}
.wrap .okmk{font-size:9.5px;color:var(--ok);border:1px solid var(--ok);border-radius:5px;padding:1px 6px;white-space:nowrap;flex:0 0 auto;}
.wrap .womk{font-size:9.5px;color:var(--mut);border:1px solid var(--line);border-radius:5px;padding:1px 6px;white-space:nowrap;flex:0 0 auto;}
.wrap .txlink{margin-top:16px;font-size:11.5px;color:var(--mut);cursor:pointer;text-align:center;padding:9px;border-radius:9px;border:1px dashed var(--line);transition:.14s;}
.wrap .txlink:hover{color:var(--ink);border-color:var(--mut);}
.wrap .gobtn{width:100%;border:0;background:var(--acc);color:#fff;font:inherit;font-size:13.5px;font-weight:600;padding:13px;border-radius:11px;cursor:pointer;letter-spacing:1px;margin-top:16px;transition:.14s;}
.wrap.night .gobtn{color:#26221e;}
.wrap .gobtn:hover{filter:brightness(1.05);}
.wrap .loading{padding:44px 20px;text-align:center;color:var(--mut);font-size:13px;}
.wrap .loading .ghost{display:block;margin:18px auto 0;padding:9px 18px;}
.wrap .genfail{cursor:default;justify-content:space-between;align-items:center;}
.wrap .genfail .gtxt{min-width:0;line-height:1.55;}
.wrap .retrybtn{flex:0 0 auto;border:1px solid var(--warn);background:transparent;color:var(--warn);font:inherit;font-size:10.5px;padding:5px 9px;border-radius:7px;cursor:pointer;}
.wrap .retrybtn:hover{background:var(--warn-soft);}
.wrap .summary-fail{display:block;cursor:default;}
.wrap .summary-fail .guide{margin:10px 0 0;}
.wrap .summary-fail .retryrow{display:flex;align-items:center;gap:10px;margin-top:9px;}
.wrap .summary-fail .retryrow .subhint{margin:0;flex:1;}
.wrap .summary-fail .retrybtn[disabled]{opacity:.45;cursor:not-allowed;}

/* mobile fallback：脚本会再按 visualViewport 精确定位；这里保证脚本尚未运行时也不重排内部 UI。 */
@media (max-width:640px), (pointer:coarse) and (max-height:600px){
  .wrap .panel,.wrap .panel.full{top:50%;right:auto;bottom:auto;left:50%;transform:translate(-50%,-50%);width:calc(100vw - 24px);height:calc(100vh - 88px);height:calc(100dvh - 88px);max-width:480px;max-height:none;border-radius:16px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
  .wrap .panel-close{width:36px;height:36px;font-size:25px;}
  .wrap .panel.full .top .prompttag{display:none;}
}
`;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderGenerationDebug(
  prompts: readonly { role: string; content: string }[],
  reasoning: string,
  content: string,
): string {
  const promptText = prompts
    .map((prompt, i) => `[${i + 1}] role=${prompt.role}\n${prompt.content}`)
    .join('\n\n');
  const reasoningText = reasoning || '（当前连接或模型未返回独立 reasoning）';
  return `<div class="debug-stack">
    <div class="runtime-summary"><b>实际发送的提示词</b></div>
    <pre class="raw">${esc(promptText)}</pre>
    <div class="runtime-summary"><b>模型 Reasoning（独立返回）</b></div>
    <pre class="raw${reasoning ? '' : ' debug-empty'}">${esc(reasoningText)}</pre>
    <div class="runtime-summary"><b>模型最终正文（原始 content）</b></div>
    <pre class="raw">${esc(content)}</pre>
  </div>`;
}
function label(title: string, time: string | null): string {
  return esc([title, time].filter(Boolean).join(' | '));
}
function paras(text: string): string {
  return text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p>${esc(p)}</p>`)
    .join('');
}

/** 结果窗档案模式：整份档案排版预览 */
function renderDoc(containers: Container[]): string {
  const p: string[] = ['<div class="shell">&lt;World_Archive&gt;</div>'];
  for (const c of containers) {
    const [o, cl] = c.kind === 'segment' ? ['[', ']'] : ['《', '》'];
    const head = c.kind === 'segment'
      ? [c.title, c.keywords, c.time].filter(Boolean).map(x => esc(x!)).join(' | ')
      : label(c.title, c.time);
    p.push(`<div class="ctitle">${o}${head}${cl}</div>`);
    if (c.summary) p.push(`<div class="big">${esc(c.summary)}</div>`);
    for (const ex of c.looseExcerpts ?? []) p.push(`<div class="exc"><span class="d">·</span> ${esc(ex.text)}</div>`);
    for (const f of c.fragments) {
      p.push(`<div class="ftitle">[${label(f.title, f.time)}]</div>`);
      if (f.summary) p.push(`<div class="small">${esc(f.summary)}</div>`);
      for (const ex of f.excerpts) p.push(`<div class="exc"><span class="d">·</span> ${esc(ex.text)}</div>`);
    }
  }
  p.push('<div class="shell">&lt;/World_Archive&gt;</div>');
  return p.join('');
}

/** 校验问题 → 短定位名 + 建议（给软疑/硬错逐条列表） */
function issueLoc(i: ValidationIssue): string {
  const m: Record<string, string> = {
    SHELL_MISSING: '缺档案外壳',
    SHELL_UNCLOSED: '外壳未闭合',
    NO_CONTAINER: '无时间轴容器',
    CONTAINER_TOKEN_BROKEN: '容器标题符号不完整',
    FRAGMENT_TOKEN_BROKEN: '片段标题符号不完整',
    CONTAINER_SUMMARY_EMPTY: '容器大总结为空',
    CONTAINER_TIME_MISSING: '容器缺时间字段',
    CONTAINER_NO_FRAGMENT: '容器只有大总结',
    FRAGMENT_TIME_MISSING: '片段缺时间字段',
    FRAGMENT_NO_EXCERPT: '片段有小总结无摘录',
    BRACKET_UNBALANCED: '摘录引号疑似不闭合',
    ARCHIVED_MARKER_FORBIDDEN: '普通档含覆盖标记',
    SEGMENT_TOKEN_BROKEN: '事件段标题符号不完整',
    NO_SEGMENT: '无普通事件段',
    CONTAINER_UNEXPECTED: '出现时间轴容器',
    SEGMENT_SUMMARY_EMPTY: '事件段总结为空',
    SEGMENT_TITLE_MISSING: '事件段缺标题',
    SEGMENT_KEYWORDS_MISSING: '事件段缺关键词',
    SEGMENT_TIME_MISSING: '事件段缺时间',
  };
  return m[i.code] ?? i.code;
}
function issueSug(i: ValidationIssue): string {
  const m: Record<string, string> = {
    SHELL_MISSING: '若正文结构清楚，可一键补正外壳；否则重新生成。',
    SHELL_UNCLOSED: '结尾漏了 </World_Archive>，可一键补正或重新生成。',
    NO_CONTAINER: '生成物必须是《》时间轴格式，重新生成。',
    CONTAINER_TOKEN_BROKEN: '若只缺闭合符可一键补正；否则手改或重新生成。',
    FRAGMENT_TOKEN_BROKEN: '若只缺闭合符可一键补正；否则手改或重新生成。',
    CONTAINER_SUMMARY_EMPTY: '这段得有内容 —— 点档案补写，或重新生成。',
    CONTAINER_TIME_MISSING: '补上时间便于时间轴定位；也可留着。',
    CONTAINER_NO_FRAGMENT: '翻一眼原文，确认要不要补一两条摘录。',
    FRAGMENT_TIME_MISSING: '补上时间范围便于定位；也可留着。',
    FRAGMENT_NO_EXCERPT: '看要不要补一两条摘录；也可留着。',
    BRACKET_UNBALANCED: '检查「」是否配对。',
    ARCHIVED_MARKER_FORBIDDEN: '删除 archived 覆盖标记；摘要 → 大总结不能接管时间轴覆盖链。',
    SEGMENT_TOKEN_BROKEN: '检查事件段的 [] 与竖线字段是否完整。',
    NO_SEGMENT: '改为一个或多个普通扁平 [] 事件段，或重新生成。',
    CONTAINER_UNEXPECTED: '摘要 → 大总结应使用 [] 事件段；可手改或保留后应用。',
    SEGMENT_SUMMARY_EMPTY: '为该事件段补上客观总结，或重新生成。',
    SEGMENT_TITLE_MISSING: '补一个简短事件标题；也可保留。',
    SEGMENT_KEYWORDS_MISSING: '补上情绪／感知关键词字段；也可保留。',
    SEGMENT_TIME_MISSING: '补上起止时间字段；也可保留。',
  };
  return m[i.code] ?? (i.severity === 'hard' ? '点档案任意处改，或重新生成。' : '可斟酌，仍可保存。');
}

type View =
  | 'hub'
  | 'setup'
  | 'summary-setup'
  | 'timeline'
  | 'detail'
  | 'result'
  | 'summary-result'
  | 'api'
  | 'integrity'
  | 'commitlog';

const COMMIT_STATUS_LABEL: Record<string, string> = {
  prepared: '已就绪 · 未落盘',
  committing: '提交中 · 可能中断',
  failed: '失败中断',
  completed: '已完成',
};

interface GenerationAttempt {
  kind: 'initial' | 'reroll';
  guidance: string;
  selection?: number[];
}

interface FailedGeneration {
  attempt: GenerationAttempt;
  message: string;
}

interface SummaryGenerationAttempt {
  kind: 'initial' | 'retry' | 'reroll';
  guidance: string;
}

interface FailedSummaryGeneration {
  attempt: SummaryGenerationAttempt;
  message: string;
}

type PromptScope = 'archive' | 'summary';

interface FullPromptEdit {
  scope: PromptScope;
  id: string;
  label: string;
  value: string;
}

interface InlinePromptDraft {
  scope: PromptScope;
  id: string;
  value: string;
}

interface PromptComparison {
  scope: PromptScope;
  id: string;
  label: string;
  customContent: string;
  customIsDraft: boolean;
  builtinContent: string;
  returnEdit: FullPromptEdit | null;
}

interface EvNode {
  floor: number;
  generation: LocatorEntry['generation'];
  container: Container;
  through: number | null;
  /** 所属权威档案块的生成时原文；编辑保存前作并发指纹。 */
  archiveRaw: string;
  /** 该容器在其所属档案里的可见序号（从 0 起）——就地编辑写回定位用 */
  localIndex: number;
}

export function createPanel(session: ArchiverSession, doc: Document = document) {
  // Shadow DOM 隔离：酒馆自己的 CSS（.panel/.card/.mark 等通用类）一律进不来
  const root = doc.createElement('div');
  root.id = 'mem-root';
  root.style.display = 'none';
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS}</style>
    <div class="wrap night" data-el="wrap">
      <div class="backdrop" data-act="close"></div>
      <div class="panel">
        <div class="panel-chrome"><button type="button" class="panel-close" data-act="close" aria-label="关闭记忆档案" title="关闭">×</button></div>
        <div data-el="view"></div>
      </div>
    </div>`;
  const wrap = shadow.querySelector('[data-el=wrap]') as HTMLElement;
  const panelEl = shadow.querySelector('.panel') as HTMLElement;
  const panelWindow = doc.defaultView ?? window;

  let view: View = 'hub';
  let snap: Snapshot | null = null;
  let cand: Candidate | null = null;
  let summaryCand: SummaryCandidate | null = null;
  let mode: 'archive' | 'debug' = 'archive';
  let summaryMode: 'archive' | 'debug' = 'archive';
  let night = true;
  let flash = '';
  let nodes: EvNode[] = [];
  let detailStart: number | null = null; // 详情页起始容器在 nodes 里的下标（从此往下连续显示）
  let detailCurIdx: number | null = null; // 详情页当前滚到的容器下标（滚动联动 sticky 抬头 + 返回定位）
  let editingIdx: number | null = null; // 正在结构化编辑的容器下标（null = 无）
  let expandMod: 'pre' | 'runtime' | 'post' | null = null;
  let summaryExpandMod: 'pre' | 'runtime' | 'post' | null = null;
  let fullEdit: FullPromptEdit | null = null; // 提示词全屏编辑
  let inlinePromptDraft: InlinePromptDraft | null = null; // 查看／确认新版前保住内嵌未保存草稿
  let promptComparison: PromptComparison | null = null; // 内置新版只读对照
  let showRetired = false; // 时间轴是否显示退役档（默认藏起冷存旧档，去历史杂音）
  let candEditing = false;
  let summaryCandEditing = false;
  // 编辑档案时切去调试模式：先把草稿并入候选（不丢改动），并记住回来要重开编辑器。
  let reopenEditor = false;
  let summaryReopenEditor = false;
  let activeGenerationAttempt: GenerationAttempt | null = null;
  let failedGeneration: FailedGeneration | null = null;
  let activeSummaryGenerationAttempt: SummaryGenerationAttempt | null = null;
  let failedSummaryGeneration: FailedSummaryGeneration | null = null;
  /** 关闭/取消后使旧 async continuation 自动失效。 */
  let generationUiEpoch = 0;
  let destroyed = false;
  let renderedSurface: string | null = null;
  /** 范围选择只保存“选到哪一层”；所有更早可收原始档自动包含，绝不允许中间挖洞。 */
  let rangeThrough: number | null = null;
  /** 面板相对当前可视区中心的偏移；每次重新打开归中，当前打开期间可拖动。 */
  let panelOffset = { x: 0, y: 0 };
  let panelMoved = false;
  let drag:
    | {
        pointerId: number;
        startClientX: number;
        startClientY: number;
        startOffsetX: number;
        startOffsetY: number;
        handle: HTMLElement;
      }
    | null = null;
  const viewEl = () => shadow.querySelector('[data-el=view]') as HTMLElement;

  /**
   * iOS/SillyTavern 内嵌页里 layout viewport 可能远大于或偏离眼前区域。
   * visualViewport 给出的 offset + 宽高才是用户此刻真正看得到的矩形。
   */
  function visibleViewport() {
    const vv = panelWindow.visualViewport;
    return vv
      ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height }
      : { left: 0, top: 0, width: panelWindow.innerWidth, height: panelWindow.innerHeight };
  }

  function clamp(value: number, min: number, max: number): number {
    if (max < min) return (min + max) / 2;
    return Math.min(max, Math.max(min, value));
  }

  /** 同一套内部 UI；只根据真正可见区域计算外框尺寸和位置。 */
  function layoutPanel(resetPosition = false): void {
    const viewport = visibleViewport();
    if (viewport.width <= 0 || viewport.height <= 0) return;

    const coarsePointer = panelWindow.matchMedia?.('(pointer: coarse)').matches ?? false;
    const mobile = viewport.width <= 640 || (coarsePointer && viewport.height <= 600);
    const fullDesktop = (!!fullEdit || !!promptComparison) && !mobile;
    const horizontalMargin = mobile ? 12 : fullDesktop ? 16 : viewport.width * 0.03;
    const verticalMargin = mobile ? 44 : fullDesktop ? 20 : viewport.height * 0.03;
    const maxWidth = fullDesktop ? 900 : 480;
    const maxHeight = fullDesktop ? 900 : mobile ? Number.POSITIVE_INFINITY : 620;
    const width = Math.max(1, Math.min(maxWidth, viewport.width - 2 * horizontalMargin));
    const height = Math.max(1, Math.min(maxHeight, viewport.height - 2 * verticalMargin));
    const viewportCenter = {
      x: viewport.left + viewport.width / 2,
      y: viewport.top + viewport.height / 2,
    };

    if (resetPosition) {
      panelOffset = { x: 0, y: 0 };
      panelMoved = false;
    }

    let left = viewportCenter.x + panelOffset.x - width / 2;
    let top = viewportCenter.y + panelOffset.y - height / 2;
    if (panelMoved) {
      // 拖动后的浮窗可部分离屏，但至少留下可抓回来的标题栏区域。
      const minGrabWidth = Math.min(180, width);
      const minGrabHeight = Math.min(48, height);
      left = clamp(
        left,
        viewport.left - width + minGrabWidth,
        viewport.left + viewport.width - minGrabWidth,
      );
      top = clamp(top, viewport.top - 12, viewport.top + viewport.height - minGrabHeight);
    } else {
      // 初次出现完整收进当前可视区。
      left = clamp(left, viewport.left, viewport.left + viewport.width - width);
      top = clamp(top, viewport.top, viewport.top + viewport.height - height);
    }
    panelOffset = {
      x: left + width / 2 - viewportCenter.x,
      y: top + height / 2 - viewportCenter.y,
    };

    panelEl.style.width = `${width}px`;
    panelEl.style.height = `${height}px`;
    panelEl.style.maxWidth = 'none';
    panelEl.style.maxHeight = 'none';
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
    panelEl.style.transform = 'none';
  }

  function onViewportChange(): void {
    if (root.style.display !== 'none') layoutPanel();
  }

  panelWindow.addEventListener('resize', onViewportChange);
  panelWindow.visualViewport?.addEventListener('resize', onViewportChange);
  panelWindow.visualViewport?.addEventListener('scroll', onViewportChange);

  /** 日/夜切换钮 —— 跟每个视图标题栏一起渲染，永远看得见 */
  function dnToggle(): string {
    return `<div class="daynight"><span class="dn${night ? '' : ' on'}" data-t="day">日</span><span class="dn${night ? ' on' : ''}" data-t="night">夜</span></div>`;
  }

  function doRefresh() {
    snap = session.refresh();
  }

  // ---- 编排分区（前置 / 运行时填入=数据段 / 后置） -------------------------
  // 运行时填入 = 从 historical_context 到 guidance（含）这一整段「数据段」：外壳 + 既存/原始 + 注意 + 补充信息。
  function orchParts() {
    const entries = session.orchestrationEntries();
    const hi = entries.findIndex(e => e.kind === 'historical_context');
    const gi = entries.findIndex(e => e.kind === 'guidance');
    const start = hi < 0 ? entries.length : hi;
    const end = gi < 0 ? start - 1 : gi;
    return { pre: entries.slice(0, start), runtime: entries.slice(start, end + 1), post: entries.slice(end + 1) };
  }

  function promptState(scope: PromptScope, id: string) {
    return scope === 'summary'
      ? session.summaryOrchestrationState(id as SummaryPromptId)
      : session.orchestrationState(id);
  }

  function inlinePromptValue(scope: PromptScope, id: string, fallback: string): string {
    return inlinePromptDraft?.scope === scope && inlinePromptDraft.id === id
      ? inlinePromptDraft.value
      : fallback;
  }

  /** 捕获当前可见编辑器；只读查看或确认新版都不得吞掉尚未保存的字。 */
  function capturePromptDraft(scope: PromptScope, id: string): string | null {
    if (fullEdit?.scope === scope && fullEdit.id === id) {
      const textarea = shadow.querySelector('[data-el=fulltext]') as HTMLTextAreaElement | null;
      const value = textarea?.value ?? fullEdit.value;
      fullEdit = { ...fullEdit, value };
      return value;
    }

    const selector = scope === 'summary' ? 'textarea[data-soid]' : 'textarea[data-oid]';
    const textarea = [...shadow.querySelectorAll<HTMLTextAreaElement>(selector)].find(element =>
      (scope === 'summary' ? element.dataset.soid : element.dataset.oid) === id,
    );
    if (textarea) {
      inlinePromptDraft = { scope, id, value: textarea.value };
      return textarea.value;
    }
    return inlinePromptDraft?.scope === scope && inlinePromptDraft.id === id
      ? inlinePromptDraft.value
      : null;
  }

  function clearInlinePromptDraft(scope?: PromptScope, id?: string): void {
    if (!inlinePromptDraft) return;
    if (scope && inlinePromptDraft.scope !== scope) return;
    if (id && inlinePromptDraft.id !== id) return;
    inlinePromptDraft = null;
  }

  function promptUpdateCard(scope: PromptScope, id: string): string {
    if (!promptState(scope, id).builtinUpdateAvailable) return '';
    return `<div class="prompt-update-card">
      <div class="prompt-update-title">内置提示词已有新版</div>
      <div class="prompt-update-copy">当前仍使用你的自定义版本。此选择适用于所有聊天；查看不会改变当前内容。</div>
      <div class="prompt-update-actions">
        <button type="button" class="prompt-action" data-act="prompt-view-builtin" data-prompt-scope="${scope}" data-prompt-id="${esc(id)}">查看内置新版</button>
        <button type="button" class="prompt-action keep" data-act="prompt-keep-custom" data-prompt-scope="${scope}" data-prompt-id="${esc(id)}">继续使用我的版本</button>
        <button type="button" class="prompt-action use" data-act="prompt-use-builtin" data-prompt-scope="${scope}" data-prompt-id="${esc(id)}">使用内置新版</button>
      </div>
    </div>`;
  }

  /** 当前阈值外可收的原始档，按楼层去重并升序。 */
  function rangeSources(): Array<{ floor: number; title: string }> {
    if (!snap) return [];
    const byFloor = new Map<number, string>();
    for (const e of session.collect(snap).sources) {
      if (byFloor.has(e.messageId)) continue;
      const title = parseArchiveBody(e.content).map(c => c.title).find(Boolean) || '（无题）';
      byFloor.set(e.messageId, title);
    }
    return [...byFloor].map(([floor, title]) => ({ floor, title })).sort((a, b) => a.floor - b.floor);
  }

  function resetRangeSelection() {
    const sources = rangeSources();
    rangeThrough = sources.length ? sources[sources.length - 1].floor : null;
  }

  function selectedRangeFloors(): number[] {
    if (rangeThrough == null) return [];
    return rangeSources().filter(x => x.floor <= rangeThrough!).map(x => x.floor);
  }

  function generationFailureHtml(kind: GenerationAttempt['kind']): string {
    if (!failedGeneration || failedGeneration.attempt.kind !== kind) return '';
    return `<div class="warnbar genfail"><span class="gtxt">${esc(failedGeneration.message)}</span><button type="button" class="retrybtn" data-act="retry-generation">按相同参数重试</button></div>`;
  }

  function summaryInitialFailureHtml(): string {
    const failed = failedSummaryGeneration;
    if (!failed || failed.attempt.kind === 'reroll') return '';
    const retryable = session.summaryRetryAvailable();
    return `<div class="warnbar summary-fail">
      <div class="gtxt">${esc(failed.message)}</div>
      <div class="guide"><div class="glab">同一批来源重试的补充引导 · 可留空</div>
        <input data-el="summary-retry-guide" placeholder="例如：优先保留某段因果、动作或对白" value="${esc(failed.attempt.guidance)}"></div>
      <div class="retryrow"><button type="button" class="ghost" data-act="summary-failed-discard">放弃本轮</button><span class="subhint">${retryable ? '只重跑生成；来源批次保持不变' : '这次尚未冻结出可重试的来源批次，请重新开始'}</span>
        <button type="button" class="retrybtn" data-act="summary-retry"${retryable ? '' : ' disabled'}>同一批来源重试</button></div>
    </div>`;
  }

  function summaryRerollFailureHtml(): string {
    const failed = failedSummaryGeneration;
    if (!failed || failed.attempt.kind !== 'reroll') return '';
    return `<div class="warnbar genfail"><span class="gtxt">${esc(failed.message)} · 原候选仍保留</span></div>`;
  }

  function interruptedProgressText(): string {
    const log = snap?.commitLog;
    if (!log || log.status === 'completed') return '无薄日志（旧版中断），无法安全推断已进行到哪一步';
    const old = log.oldSucceededFloors.length ? log.oldSucceededFloors.join('、') : '无';
    const promoted = log.promotedFloor == null ? '尚未转正' : `层 ${log.promotedFloor} 已转正`;
    const supersede = log.supersede ? ` · 既存接管${log.supersede.done ? '已完成' : '未完成'}` : '';
    return `pending 目标层 ${log.targetFloor} · 已 old 层 ${old} · ${promoted}${supersede}`;
  }

  // ---- 视图 ----------------------------------------------------------------

  function renderHub(): string {
    const s = snap;
    const liveN = s ? s.table.filter(e => e.generation === 'live').length : 0;
    const trig = s?.trigger;
    const timelineEnabled = session.config.timelineEnabled !== false;
    const summaryEnabled = session.config.summaryEnabled !== false;
    const due = trig?.eligible
      ? `<div class="stat due"><span class="pin"></span>该总结了 · 可总结 ${trig.range?.from}–${trig.range?.to}</div>`
      : `<div class="stat">上次总结至 <b>层 ${s?.boundary ?? 0}</b></div>`;
    const disabledStatus = '<div class="stat disabled">未启用 · 仍可手动开始</div>';
    const featureSwitch = (feature: 'summary' | 'timeline', enabled: boolean, label: string) => `
      <button type="button" class="feature-switch" data-act="toggle-${feature}" role="switch"
        aria-checked="${enabled}" aria-label="${enabled ? '关闭' : '启用'}${label}"
        title="${enabled ? '关闭' : '启用'}${label}"></button>`;
    const integrityBar = s?.integrity.needed && !s.interrupted.length
      ? `<div class="warnbar" data-act="integrity-open">⚠ 检测到 ${s.integrity.toRestore.length} 份需复原的退役档 · 点此处理</div>`
      : '';
    const interruptedBar = s?.interrupted.length
      ? `<div class="warnbar" data-act="commitlog-open">⚠ 检测到 ${s.interrupted.length} 份未完成 pending · ${esc(interruptedProgressText())} · 点此查看／继续</div>`
      : '';
    const commitLogLink = s?.commitLog && !s.interrupted.length
      ? `<div class="txlink" data-act="commitlog-open">提交事务日志 · 最近一笔${esc(COMMIT_STATUS_LABEL[s.commitLog.status] ?? s.commitLog.status)} ›</div>`
      : '';
    const connectionProfiles = session.connectionProfiles();
    const connectionStatus = (profileId: string | null): string => {
      const selected = connectionProfiles.find(profile => profile.id === profileId);
      if (selected) return `${esc(selected.name)}${selected.model ? ` · ${esc(selected.model)}` : ''}`;
      return profileId ? '原配置已不存在' : '跟随当前连接';
    };
    const summaryConnectionStatus = connectionStatus(session.config.summaryConnectionProfileId);
    const timelineConnectionStatus = connectionStatus(session.config.timelineConnectionProfileId);
    const promptUpdates = session.promptOverrideSummary().updates;
    const promptUpdateDot = promptUpdates
      ? `<span class="updot" title="${promptUpdates} 处自定义提示词有内置新版"></span>`
      : '';
    const summaryPromptUpdates = session.summaryPromptOverrideSummary().updates;
    const summaryPromptUpdateDot = summaryPromptUpdates
      ? `<span class="updot" title="${summaryPromptUpdates} 处摘要 → 大总结提示词有内置新版"></span>`
      : '';
    const summaryTrig = s?.summaryTrigger;
    const latestArchive = s?.latestLiveArchiveFloor ?? null;
    const summaryStatus = latestArchive === null
      ? `<div class="stat${summaryTrig?.eligible ? ' due' : ''}">${summaryTrig?.eligible ? '<span class="pin"></span>' : ''}尚无 Archive · 已累计 <b>${summaryTrig?.distance ?? 0} 层</b></div>`
      : `<div class="stat${summaryTrig?.eligible ? ' due' : ''}">${summaryTrig?.eligible ? '<span class="pin"></span>' : ''}最近 Archive 层 <b>${latestArchive}</b> · 距今 ${summaryTrig?.distance ?? 0} 层</div>`;
    return `
      <div class="head"><div class="title">记忆档案</div><span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
        ${interruptedBar}
        ${integrityBar}
        <div class="rect" data-act="timeline">
          <span class="mark"></span>
          <div class="tx"><div class="t">时间轴与档案</div>
            <div class="d">当前聊天的档案一览 · 点任一条进详情</div>
            <div class="st"><b>${liveN} 条</b> · 占 ~${s?.totalLiveSize ?? 0} 字</div></div>
          <span class="go">›</span>
        </div>
        <div class="rect" data-act="api">
          <span class="mark"></span>
          <div class="tx"><div class="t">API 配置</div>
            <div class="d">为两个总结任务分别选择酒馆保存的连接配置</div>
            <div class="st"><b>摘要</b> ${summaryConnectionStatus}<br><b>时间轴</b> ${timelineConnectionStatus}</div></div>
          <span class="go">›</span>
        </div>
        <div class="grouplab">总结设置 · 单次设好基本不动</div>
        <div class="squares">
          <div class="sq" data-act="summary-setup">
            <div class="sqtop"><span class="dot"></span>${featureSwitch('summary', summaryEnabled, '摘要 → 大总结')}</div>
            <div class="t">摘要 → 大总结${summaryPromptUpdateDot}</div>
            <div class="sp"></div>${summaryEnabled ? summaryStatus : disabledStatus}
          </div>
          <div class="sq" data-act="setup">
            <div class="sqtop"><span class="dot"></span>${featureSwitch('timeline', timelineEnabled, '大总结时间轴化')}</div>
            <div class="t">大总结时间轴化${promptUpdateDot}</div>
            <div class="d">进一步压缩大总结的内容</div><div class="sp"></div>${timelineEnabled ? due : disabledStatus}
          </div>
        </div>
        ${commitLogLink}
      </div>`;
  }

  function renderSetup(): string {
    const s = snap;
    const n = session.config.n;
    const boundary = s?.boundary ?? session.config.boundary ?? 0;
    const trig = s?.trigger;
    const nextFloor = boundary + 2 * n;
    const sources = rangeSources();
    if (rangeThrough != null && !sources.some(x => x.floor === rangeThrough)) {
      rangeThrough = sources.length ? sources[sources.length - 1].floor : null;
    }
    const selected = selectedRangeFloors();
    const interrupted = (s?.interrupted.length ?? 0) > 0;
    const integrityBlocked = !!s?.integrity.needed;
    const canRun = selected.length > 0 && !interrupted && !integrityBlocked;
    const { pre, post } = orchParts();
    const collected = snap ? session.collect(snap) : null;
    const promptSummary = session.promptOverrideSummary();

    const moduleEdit = (entries: { id: string; content: string }[]) => {
      return `<div class="modedit">${entries.map(e => `<textarea data-oid="${esc(e.id)}">${esc(inlinePromptValue('archive', e.id, e.content))}</textarea>${promptUpdateCard('archive', e.id)}`).join('')}</div>`;
    };
    const moduleState = (entries: { id: string }[]) => {
      const states = entries.map(entry => session.orchestrationState(entry.id));
      return {
        customized: states.some(state => state.customized),
        update: states.some(state => state.builtinUpdateAvailable),
      };
    };
    const moduleTags = (entries: { id: string }[]) => {
      const state = moduleState(entries);
      if (!state.customized) return '<span class="prompttag">跟随内置</span>';
      return `<span class="prompttag custom">自定义</span>${
        state.update ? '<span class="prompttag update">内置有新版</span>' : ''
      }`;
    };
    const moduleActions = (entries: { id: string }[], modKey: 'pre' | 'post') => {
      if (expandMod !== modKey) return `<span class="pen">✎</span>`;
      const first = entries[0];
      return `<span class="mod-actions">${first ? `<span class="fullbtn" data-act="full-open" data-oid="${esc(first.id)}" title="全屏编辑">⛶</span>` : ''}
        ${first && session.orchestrationState(first.id).customized ? `<span class="headact" data-act="mod-reset" data-oid="${esc(first.id)}">使用内置最新版</span>` : ''}
        <span class="headact" data-act="mod-cancel">取消</span>
        <span class="headact saveact" data-act="mod-save" data-mod="${modKey}">保存</span></span>`;
    };
    const preEdit = expandMod === 'pre' ? moduleEdit(pre) : '';
    const postEdit = expandMod === 'post' ? moduleEdit(post) : '';
    // 运行时填入只展示紧凑摘要，不再把整份真实档案重复塞进设置页。
    const runEdit =
      expandMod === 'runtime'
        ? `<div class="modedit"><div class="runtime-summary">
            <div><b>既存档</b> ${collected?.continuity ? `层 ${collected.continuity.messageId}` : '无'}</div>
            <div><b>本轮原始档</b> ${selected.length ? selected.map(x => `层 ${x}`).join('、') : '未选择'}</div>
            <div><b>补充引导</b> 在结果窗按需填入</div>
          </div></div>`
        : '';

    const rangeItems = sources
      .map(
        x => `<label class="rangeitem"><input type="checkbox" data-el="range-floor" value="${x.floor}"${rangeThrough != null && x.floor <= rangeThrough ? ' checked' : ''}>
          <span class="rfloor">层 ${x.floor}</span><span class="rtitle">${esc(x.title)}</span></label>`,
      )
      .join('');

    return `
      <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">大总结时间轴化</span><span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
        ${generationFailureHtml('initial')}
        ${interrupted ? `<div class="warnbar">⚠ 有未完成 pending；${esc(interruptedProgressText())}；当前禁止开始新归档</div>` : ''}
        ${integrityBlocked && !interrupted ? '<div class="warnbar">⚠ 档案完整性缺口尚未复原；当前禁止开始新归档</div>' : ''}
        <button class="runbtn${canRun ? '' : ' off'}" data-act="run"${canRun ? '' : ' disabled'}>开始总结</button>
        <div class="setwrap">
          <div class="setrow"><span>保留最近</span>
            <span class="num"><button data-act="n-dec"${n <= MIN_N ? ' disabled' : ''}>−</button><input data-el="nval" type="number" min="${MIN_N}" step="50" value="${n}" inputmode="numeric"><button data-act="n-inc">＋</button></span>
            <span>层不总结</span></div>
          <div class="subhint">${
            trig?.eligible
              ? `现在可总结 ${trig?.range?.from}–${trig?.range?.to} 层`
              : `下次总结预计在 层 ${nextFloor}（上次总结至 ${boundary}）`
          }</div>
        </div>
        <div class="rangebox">
          <div class="rangehead"><b>本轮范围</b><span>按时间连续选择 · 已选 ${selected.length}/${sources.length}</span><span class="grow"></span>
            <span class="rangectl" data-act="range-all">全选</span><span class="rangectl" data-act="range-none">清空</span></div>
          <div class="rangeitems">${rangeItems || '<div class="empty" style="padding:12px 0">当前没有达到阈值的原始档</div>'}</div>
        </div>
        <div class="promptsec"><div class="seclab">预设提示词与架构 · 铅笔编辑</div><span class="grow"></span>
          ${
            promptSummary.customized
              ? `<span class="promptcontrols">${promptSummary.updates ? '<span class="promptnotice">内置提示词有新版</span>' : ''}<span class="promptreset" data-act="prompt-reset-all">全部使用内置最新版</span></span>`
              : '<span class="promptfollow">自动跟随内置最新版</span>'
          }</div>
        <div class="prompt-global-note">提示词是插件级设置，保存后适用于所有聊天。</div>
        <div class="mods">
          <div class="mod" data-mod="pre">
            <div class="modhead" data-act="mod-toggle" data-mod="pre"><span class="mt">前置提示词</span>${moduleTags(pre)}<span class="grow"></span>${moduleActions(pre, 'pre')}</div>
            ${preEdit}
          </div>
          <div class="mod ro">
            <div class="modhead" data-act="mod-toggle" data-mod="runtime"><span class="mt">运行时填入</span><span class="rotag">只读</span><span class="grow"></span><span class="pen">${expandMod === 'runtime' ? '▴' : '▾'}</span></div>
            ${runEdit}
          </div>
          <div class="mod" data-mod="post">
            <div class="modhead" data-act="mod-toggle" data-mod="post"><span class="mt">后置提示词</span>${moduleTags(post)}<span class="grow"></span>${moduleActions(post, 'post')}</div>
            ${postEdit}
          </div>
        </div>
      </div>`;
  }

  function renderSummarySetup(): string {
    const s = snap;
    const trigger = s?.summaryTrigger;
    const x = s?.latestLiveArchiveFloor ?? null;
    const q = s?.currentFloor ?? 0;
    const interrupted = (s?.interrupted.length ?? 0) > 0;
    const integrityBlocked = !!s?.integrity.needed;
    // interval 只决定何时提醒；手动开始仅受真实会话互斥／完整性状态约束。
    const canRun = session.phase === 'idle' && !interrupted && !integrityBlocked;
    const entries = session.summaryOrchestrationEntries();
    const pre = entries.find(entry => entry.id === 'pre')!;
    const runtime = entries.find(entry => entry.id === 'runtime')!;
    const post = entries.find(entry => entry.id === 'post')!;
    const promptSummary = session.summaryPromptOverrideSummary();
    const archiveFloors = [...new Set((s?.table ?? [])
      .filter(entry => entry.generation === 'live')
      .map(entry => entry.messageId))].sort((a, b) => a - b);

    const moduleTags = (id: SummaryPromptId) => {
      const state = session.summaryOrchestrationState(id);
      if (!state.customized) return '<span class="prompttag">跟随内置</span>';
      return `<span class="prompttag custom">自定义</span>${
        state.builtinUpdateAvailable ? '<span class="prompttag update">内置有新版</span>' : ''
      }`;
    };
    const moduleActions = (entry: typeof pre, modKey: 'pre' | 'post') => {
      if (summaryExpandMod !== modKey) return '<span class="pen">✎</span>';
      const state = session.summaryOrchestrationState(entry.id);
      return `<span class="mod-actions"><span class="fullbtn" data-act="full-open" data-scope="summary" data-oid="${entry.id}" title="全屏编辑">⛶</span>
        ${state.customized ? `<span class="headact" data-act="summary-mod-reset" data-oid="${entry.id}">使用内置最新版</span>` : ''}
        <span class="headact" data-act="summary-mod-cancel">取消</span>
        <span class="headact saveact" data-act="summary-mod-save" data-mod="${modKey}">保存</span></span>`;
    };
    const moduleEdit = (entry: typeof pre) => summaryExpandMod === entry.id
      ? `<div class="modedit"><textarea data-soid="${entry.id}">${esc(inlinePromptValue('summary', entry.id, entry.content))}</textarea>${promptUpdateCard('summary', entry.id)}</div>`
      : '';
    const runtimeEdit = summaryExpandMod === 'runtime'
      ? `<div class="modedit"><div class="runtime-summary">
          <div><b>Historical Context</b> 以下两类内容按顺序合并进同一个只读上下文</div>
          <div><b>World Archive</b> 全部完整在场档案${archiveFloors.length ? ` · 层 ${archiveFloors.join('、')}` : ' · 无'}</div>
          <div><b>捕获 Flux</b> ${x === null ? `最早楼层至当前层 ${q}` : `层 ${x} 之后至当前层 ${q}`}的完整 Flux / Causal_Flux</div>
          <div><b>补充引导</b> 首次可空；失败重试与结果重跑均可手动填写</div>
        </div></div>`
      : '';
    const reminderText = trigger?.eligible
      ? `已达到 ${trigger.interval} 层提醒间隔；这只是提醒，仍可随时手动开始`
      : `距最近 Archive ${trigger?.distance ?? 0} 层 · 到层 ${trigger?.nextFloor ?? q} 时提醒；仍可现在手动开始`;

    return `
      <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">摘要 → 大总结</span><span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
        ${summaryInitialFailureHtml()}
        ${interrupted ? `<div class="warnbar">⚠ 有未完成 pending；${esc(interruptedProgressText())}；当前禁止开始摘要 → 大总结</div>` : ''}
        ${integrityBlocked && !interrupted ? '<div class="warnbar">⚠ 档案完整性缺口尚未复原；当前禁止开始摘要 → 大总结</div>' : ''}
        <button class="runbtn${canRun ? '' : ' off'}" data-act="summary-run"${canRun ? '' : ' disabled'}>开始生成大总结</button>
        <div class="setwrap">
          <div class="setrow"><span>每隔</span>
            <span class="num"><button data-act="summary-interval-dec"${(trigger?.interval ?? session.config.summaryInterval) <= MIN_SUMMARY_INTERVAL ? ' disabled' : ''}>−</button><input data-el="summary-interval" type="number" min="${MIN_SUMMARY_INTERVAL}" step="10" value="${trigger?.interval ?? session.config.summaryInterval}" inputmode="numeric"><button data-act="summary-interval-inc">＋</button></span>
            <span>层提醒一次</span></div>
          <div class="subhint">${reminderText}</div>
          <div class="subhint">最近 Archive：${x === null ? '无（x = null）' : `层 ${x}（x = ${x}）`} · 当前聊天末层 ${q}</div>
        </div>
        <div class="promptsec"><div class="seclab">固定三段式提示词 · 铅笔编辑</div><span class="grow"></span>
          ${promptSummary.customized
            ? `<span class="promptcontrols">${promptSummary.updates ? '<span class="promptnotice">内置提示词有新版</span>' : ''}<span class="promptreset" data-act="summary-prompt-reset-all">全部使用内置最新版</span></span>`
            : '<span class="promptfollow">自动跟随内置最新版</span>'}
        </div>
        <div class="prompt-global-note">提示词是插件级设置，保存后适用于所有聊天。</div>
        <div class="mods">
          <div class="mod" data-summary-mod="pre">
            <div class="modhead" data-act="summary-mod-toggle" data-mod="pre"><span class="mt">${esc(pre.label)}</span>${moduleTags('pre')}<span class="grow"></span>${moduleActions(pre, 'pre')}</div>
            ${moduleEdit(pre)}
          </div>
          <div class="mod ro">
            <div class="modhead" data-act="summary-mod-toggle" data-mod="runtime"><span class="mt">${esc(runtime.label)}</span><span class="rotag">只读</span><span class="grow"></span><span class="pen">${summaryExpandMod === 'runtime' ? '▴' : '▾'}</span></div>
            ${runtimeEdit}
          </div>
          <div class="mod" data-summary-mod="post">
            <div class="modhead" data-act="summary-mod-toggle" data-mod="post"><span class="mt">${esc(post.label)}</span>${moduleTags('post')}<span class="grow"></span>${moduleActions(post, 'post')}</div>
            ${moduleEdit(post)}
          </div>
        </div>
      </div>`;
  }

  function buildNodes(): EvNode[] {
    const out: EvNode[] = [];
    const entries = snap
      ? snap.table.filter(e => e.generation === 'live' || (showRetired && e.generation === 'old'))
      : [];
    for (const e of entries) {
      parseArchiveBody(e.content).forEach((c, localIndex) => {
        out.push({
          floor: e.messageId,
          generation: e.generation,
          container: c,
          through: e.through,
          archiveRaw: e.raw,
          localIndex,
        });
      });
    }
    // 一律按楼层（≈ 故事时间线）升序，退役档也就地插进时间轴、不再堆到末尾；
    // 退役仍靠淡显 + 空心点 + 「· 退役」标记区分。同层用 span 保序（源档在前、时间轴档在后）。
    return out.sort((a, b) => a.floor - b.floor);
  }

  function renderTimeline(): string {
    nodes = buildNodes();
    const floors = snap ? snap.table.filter(e => e.generation === 'live').map(e => e.messageId) : [];
    const cover = floors.length ? `覆盖 ${Math.min(...floors)}–${Math.max(...floors)} 层` : '暂无在场档案';
    const lastFloor = snap?.currentFloor ?? 0;
    const spine = nodes
      .map((nd, i) => {
        const retired = nd.generation !== 'live';
        const yr = nd.container.time || (nd.container.keywords ?? '—');
        return `<div class="ev${retired ? ' retired' : ''}">
          <span class="edot${retired ? ' hollow' : ''}"></span>
          <div class="card" data-act="detail" data-i="${i}"><div class="yr">${esc(yr)}${retired ? ' · 退役' : ''}</div><div class="nm">${esc(nd.container.title || '（无题）')}</div></div>
        </div>`;
      })
      .join('');
    return `
      <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">时间轴</span><span class="grow"></span><span class="refresh">${lastFloor} 层</span>${dnToggle()}</div>
      <div class="body">
        <div class="metarow"><span class="meta">${nodes.length} 条 · ${cover}</span><span class="rettoggle" data-act="toggle-retired">${showRetired ? '隐藏退役档' : '显示退役档'}</span></div>
        ${nodes.length ? `<div class="spine">${spine}</div><div class="scrollpad"></div>` : '<div class="empty">当前聊天暂无档案</div>'}
      </div>`;
  }

  /** 一条摘录的结构化编辑行（· 锁定、正文可改、× 删） */
  function excRow(text: string): string {
    return `<div class="se-exc"><span class="star">·</span><span class="f line" contenteditable="true">${esc(text)}</span><span class="del" data-act="exc-del">×</span></div>`;
  }

  /** 04 结构化编辑器：结构符号灰锁，标题/时间/总结/摘录有底框可改，摘录可加删 */
  function structuredEditor(c: Container, idx: number): string {
    const isSeg = c.kind === 'segment';
    const [o, cl] = isSeg ? ['[', ']'] : ['《', '》'];
    const kw =
      isSeg && c.keywords != null
        ? `<span class="tok">|</span><span class="f" contenteditable="true" data-f="keywords">${esc(c.keywords)}</span>`
        : '';
    const loose = (c.looseExcerpts ?? []).map(ex => excRow(ex.text)).join('');
    const frags = c.fragments
      .map(
        f => `
        <div class="se-frag">
          <div class="se-ftitle"><span class="tok">[</span><span class="f" contenteditable="true" data-ff="title">${esc(f.title)}</span><span class="tok">|</span><span class="f time" contenteditable="true" data-ff="time">${esc(f.time ?? '')}</span><span class="tok">]</span></div>
          <div class="fblock" contenteditable="true" data-ff="summary">${esc(f.summary)}</div>
          <div class="se-excs">${f.excerpts.map(ex => excRow(ex.text)).join('')}</div>
          <div class="excadd" data-act="exc-add">＋ 加一条摘录</div>
        </div>`,
      )
      .join('');
    return `<div class="se-root" data-idx="${idx}">
      <div class="selegend"><span class="lk">灰色</span> 是被抓取的结构（锁定）· <span class="ed">有底框</span> 的才可改 · 摘录逐条改/删</div>
      <div class="se-ctitle"><span class="tok">${o}</span><span class="f" contenteditable="true" data-f="title">${esc(c.title)}</span>${kw}<span class="tok">|</span><span class="f time" contenteditable="true" data-f="time">${esc(c.time ?? '')}</span><span class="tok">${cl}</span></div>
      <div class="fblock" contenteditable="true" data-f="summary">${esc(c.summary)}</div>
      <div class="se-loose">${loose}${isSeg ? '<div class="excadd" data-act="exc-add-loose">＋ 加一条摘录</div>' : ''}</div>
      ${frags}
      <div class="editbar2"><span class="cancel" data-act="cedit-cancel">取消</span><span class="savem" data-act="cedit-save">保存</span></div>
    </div>`;
  }

  /** 只读容器卡（可编辑时整块可点进结构化编辑） */
  function readContainer(nd: EvNode, idx: number): string {
    const c = nd.container;
    const isSeg = c.kind === 'segment';
    const editable = nd.generation === 'live';
    const frags = c.fragments
      .map(f => {
        const exc = f.excerpts.map(ex => `<div class="dexc"><span class="d">·</span> ${esc(ex.text)}</div>`).join('');
        return `<div class="dftitle">[${label(f.title, f.time)}]</div>${f.summary ? `<div class="dsmall">${esc(f.summary)}</div>` : ''}${exc}`;
      })
      .join('');
    const loose = (c.looseExcerpts ?? []).map(ex => `<div class="dexc"><span class="d">·</span> ${esc(ex.text)}</div>`).join('');
    return `<div class="rcont${editable ? ' editable' : ''}" data-cidx="${idx}" data-cname="${esc(c.title || '（无题）')}" data-ctime="${esc(c.time || '')}"${editable ? ` data-act="edit-container" data-i="${idx}" title="点这个大容器 · 结构化编辑"` : ''}>
        <div class="chead"><div class="cline">${c.time ? `<span class="cyr">${esc(c.time)}</span>` : ''}<span class="cname">${isSeg ? '[' : '《'}${esc(c.title || '（无题）')}${isSeg ? ']' : '》'}</span></div></div>
        <div class="crange">来源 层 ${nd.floor}${nd.generation !== 'live' ? ' · 退役 old_' : ''}${isSeg ? ' · 旧扁平段' : ''}${c.keywords ? ' · ' + esc(c.keywords) : ''}</div>
        <div class="prose">${c.summary ? paras(c.summary) : '<p style="color:var(--faint)">（无大总结）</p>'}</div>
        ${frags}${loose}
      </div>`;
  }

  function renderDetail(): string {
    nodes = buildNodes();
    if (detailStart == null || detailStart >= nodes.length) detailStart = 0;
    const first = nodes[detailStart];
    if (!first) return renderTimeline();
    const cur = detailCurIdx != null && nodes[detailCurIdx] ? nodes[detailCurIdx] : first;
    const c0 = cur.container;
    const head = `<div class="top"><span class="back" data-act="back-timeline" title="返回时间轴（回到当前容器位置）">‹</span><span class="now">${esc(c0.title || '（无题）')}${c0.time ? ` <small>${esc(c0.time)}</small>` : ''}</span>${cur.generation === 'live' && editingIdx == null ? '<span class="badge">可编辑</span>' : ''}<span class="grow"></span>${dnToggle()}</div>`;
    // 整条时间轴都渲染出来（上下都能滑）；进来时滚到点中的那一条（scrollDetailTo）
    const body = nodes
      .map((nd, idx) => {
        const sep = idx > 0 ? '<div class="sep"><span class="d">◇</span></div>' : '';
        const card = editingIdx === idx
          ? `<div class="editing-card" data-cidx="${idx}" data-cname="${esc(nd.container.title || '（无题）')}" data-ctime="${esc(nd.container.time || '')}">${structuredEditor(nd.container, idx)}</div>`
          : readContainer(nd, idx);
        return sep + card;
      })
      .join('');
    return `${head}
      <div class="read">
        ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
        ${body}
        <div class="readnote">${editingIdx == null ? '点任一大容器 · 结构化编辑 · 上下滑可翻到别的容器' : '结构锁定 · 只改有底框的字段'}</div>
        <div class="scrollpad"></div>
      </div>`;
  }

  function renderResult(): string {
    const c = cand!;
    const v = c.validation;
    const hard = v.issues.filter(i => i.severity === 'hard');
    const soft = v.issues.filter(i => i.severity === 'soft');
    const state = !v.ok ? 'hard' : soft.length ? 'soft' : 'ok';
    const repairPreview = !candEditing ? session.repairCandidate(c) : { candidate: c, fixes: [] };
    const repairable = repairPreview.fixes.length > 0;
    const ratio = c.sourceChars > 0 ? (c.sourceChars / Math.max(1, c.body.length)).toFixed(1) : '—';
    const verify =
      state === 'ok'
        ? `<div class="verify ok"><span class="mk">✓</span><span class="vt">结构通过 · 容器与片段闭合完整</span><span class="vs">${c.containers.length} 容器</span></div>`
        : state === 'soft'
          ? `<div class="verify soft"><span class="mk">!</span><span class="vt">结构无硬错 · 有 ${soft.length} 处可斟酌</span><span class="vs">软疑不拦 · 可直接保存</span></div>`
          : `<div class="verify hard"><span class="mk">✕</span><span class="vt">结构有硬错 · 无法保存</span><span class="vs">${hard.length} 处 · 须改或重生成</span></div>`;
    const issueList = (state === 'ok'
      ? ''
      : `<div class="issues">${(state === 'hard' ? hard : soft)
          .map(
            i =>
              `<div class="iss ${i.severity}"><span class="ic">${i.severity === 'hard' ? '✕' : '!'}</span><div class="itxt"><div class="loc">${esc(
                issueLoc(i),
              )}</div><div class="desc">${esc(i.message)}</div><div class="sug">建议：${esc(issueSug(i))}</div></div></div>`,
          )
          .join('')}</div>`);

    let docHtml: string;
    if (candEditing) {
      docHtml = `<textarea class="editdoc" data-el="editdoc">${esc(c.body)}</textarea>
        <div class="ebar" style="margin-top:10px"><span class="cancel" data-act="edit-cancel">取消</span><span class="savem" data-act="edit-save">应用改动</span></div>`;
    } else if (mode === 'debug') {
      docHtml = renderGenerationDebug(c.prompts, c.reasoning, c.raw);
    } else {
      docHtml = `<div class="doc" data-act="edit-doc" title="点档案任意处 · 直接编辑">${renderDoc(c.containers)}</div>`;
    }

    const savenote =
      state === 'hard'
        ? `<span class="savenote hard">改好 ${hard.length} 处硬错才能保存</span>`
        : state === 'soft'
          ? `<span class="savenote soft">${soft.length} 处可斟酌，仍可保存</span>`
          : '';
    return `<div class="result-page">
      <div class="result-fixed">
        <div class="top"><div class="result-title"><div class="htitle">归档结果</div>
          <div class="hmeta">总结到层 ${c.through}　·　压缩 ${c.sourceChars} <span class="ar">→</span> ~${c.body.length} 字　·　约 ${ratio} : 1</div></div>
          <span class="grow"></span>${dnToggle()}<span class="discard" data-act="discard">放弃</span></div>
        <div class="result-status">
          ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
          ${generationFailureHtml('reroll')}
          ${verify}
          ${repairable ? '<div class="repairrow"><button class="repairbtn" data-act="repair">一键补正可确定的结构</button></div>' : ''}
        </div>
      </div>
      <div class="result-scroll">
        ${issueList}
        <div class="cand-head"><div class="seg">
          <button data-act="mode-archive" class="${mode === 'archive' && !candEditing ? 'on' : ''}">档案模式</button>
          <button data-act="mode-debug" class="${mode === 'debug' ? 'on' : ''}">调试模式</button></div>
          ${candEditing ? '' : '<span class="edit-cue">点档案任意处 · 直接编辑</span>'}</div>
        ${docHtml}
        <div class="guide"><div class="glab">重新生成的引导 · <b>会从头整段重跑</b> · 可留空</div>
          <input data-el="guide" placeholder="例如：哪些情节、哪些剧情需要专门保留？" value="${esc(c.guidance)}"></div>
      </div>
      <div class="result-footer"><div class="acts"><button class="ghost" data-act="reroll">重新生成</button>
        ${savenote}
        <button class="save${state === 'hard' || candEditing ? ' off' : ''}" data-act="save"${state === 'hard' || candEditing ? ' disabled' : ''}>保存</button></div></div>
    </div>`;
  }

  function renderSummaryResult(): string {
    const c = summaryCand!;
    const v = c.validation;
    const hard = v.issues.filter(issue => issue.severity === 'hard');
    const soft = v.issues.filter(issue => issue.severity === 'soft');
    const state = !v.ok ? 'hard' : soft.length ? 'soft' : 'ok';
    const ratio = c.sourceChars > 0 ? (c.sourceChars / Math.max(1, c.body.length)).toFixed(1) : '—';
    const verify = state === 'ok'
      ? `<div class="verify ok"><span class="mk">✓</span><span class="vt">普通 Archive 结构通过</span><span class="vs">${v.segments.length} 个事件段</span></div>`
      : state === 'soft'
        ? `<div class="verify soft"><span class="mk">!</span><span class="vt">结构无硬错 · 有 ${soft.length} 处可斟酌</span><span class="vs">软疑不拦 · 可直接应用</span></div>`
        : `<div class="verify hard"><span class="mk">✕</span><span class="vt">结构有硬错 · 无法应用</span><span class="vs">${hard.length} 处 · 须改或重新生成</span></div>`;
    const issueList = state === 'ok'
      ? ''
      : `<div class="issues">${(state === 'hard' ? hard : soft).map(issue =>
          `<div class="iss ${issue.severity}"><span class="ic">${issue.severity === 'hard' ? '✕' : '!'}</span><div class="itxt"><div class="loc">${esc(issueLoc(issue))}</div><div class="desc">${esc(issue.message)}</div><div class="sug">建议：${esc(issueSug(issue))}</div></div></div>`,
        ).join('')}</div>`;

    let docHtml: string;
    if (summaryCandEditing) {
      docHtml = `<textarea class="editdoc" data-el="summary-editdoc">${esc(c.body)}</textarea>
        <div class="ebar" style="margin-top:10px"><span class="cancel" data-act="summary-edit-cancel">取消</span><span class="savem" data-act="summary-edit-save">应用改动</span></div>`;
    } else if (summaryMode === 'debug') {
      docHtml = renderGenerationDebug(c.prompts, c.reasoning, c.raw);
    } else {
      docHtml = `<div class="doc" data-act="summary-edit-doc" title="点档案任意处 · 直接编辑">${renderDoc(c.containers)}</div>`;
    }

    const applyNote = state === 'hard'
      ? `<span class="savenote hard">改好 ${hard.length} 处硬错才能应用</span>`
      : state === 'soft'
        ? `<span class="savenote soft">${soft.length} 处可斟酌，仍可应用</span>`
        : '';
    const archiveFloors = c.round.archiveFloors.length ? c.round.archiveFloors.join('、') : '无';
    const fluxFloors = c.round.fluxFloors.length ? c.round.fluxFloors.join('、') : '无';

    return `<div class="result-page">
      <div class="result-fixed">
        <div class="top"><div class="result-title"><div class="htitle">摘要 → 大总结结果</div>
          <div class="hmeta">来源至层 ${c.sourceThrough}　·　压缩 ${c.sourceChars} <span class="ar">→</span> ~${c.body.length} 字　·　约 ${ratio} : 1</div></div>
          <span class="grow"></span>${dnToggle()}<span class="discard" data-act="summary-discard">放弃</span></div>
        <div class="result-status">
          ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
          ${summaryRerollFailureHtml()}
          ${verify}
        </div>
      </div>
      <div class="result-scroll">
        ${issueList}
        <div class="runtime-summary" style="margin-bottom:12px">
          <div><b>Archive Context</b> 全部在场档案 · 层 ${esc(archiveFloors)}</div>
          <div><b>Target Flux</b> 本轮冻结来源 · 层 ${esc(fluxFloors)}</div>
        </div>
        <div class="cand-head"><div class="seg">
          <button data-act="summary-mode-archive" class="${summaryMode === 'archive' && !summaryCandEditing ? 'on' : ''}">档案模式</button>
          <button data-act="summary-mode-debug" class="${summaryMode === 'debug' ? 'on' : ''}">调试模式</button></div>
          ${summaryCandEditing ? '' : '<span class="edit-cue">点档案任意处 · 直接编辑</span>'}</div>
        ${docHtml}
        <div class="guide"><div class="glab">重新生成的引导 · <b>同一批来源从头重跑</b> · 可留空</div>
          <input data-el="summary-guide" placeholder="例如：优先保留哪段因果、动作或对白？" value="${esc(c.guidance)}"></div>
      </div>
      <div class="result-footer"><div class="acts"><button class="ghost" data-act="summary-reroll">重新生成</button>
        ${applyNote}
        <button class="save${state === 'hard' || summaryCandEditing ? ' off' : ''}" data-act="summary-apply"${state === 'hard' || summaryCandEditing ? ' disabled' : ''}>应用</button></div></div>
    </div>`;
  }

  function renderApi(): string {
    const profiles = session.connectionProfiles();
    const optionsFor = (current: string | null): string => {
      const missing = current !== null && !profiles.some(profile => profile.id === current);
      return [`<option value="">跟随当前酒馆连接</option>`]
        .concat(
          missing
            ? [`<option value="${esc(current)}" selected disabled>原连接配置已不存在</option>`]
            : [],
          profiles.map(profile => {
            const meta = [profile.api, profile.model].filter(Boolean).join(' · ');
            return `<option value="${esc(profile.id)}"${profile.id === current ? ' selected' : ''}>${esc(profile.name)}${meta ? ` · ${esc(meta)}` : ''}</option>`;
          }),
        )
        .join('');
    };
    const summaryOptions = optionsFor(session.config.summaryConnectionProfileId);
    const timelineOptions = optionsFor(session.config.timelineConnectionProfileId);
    return `
      <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">API 配置</span><span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
        <section class="api-section">
          <div class="fnname">摘要 → 大总结</div>
          <div class="flabel">API 连接（取自酒馆 Connection Profiles）</div>
          <div class="apirow"><div class="sel"><select data-el="summary-connection-profile">${summaryOptions}</select><span class="chev">▾</span></div>
            <button class="save api-save" data-act="api-save-summary">保存</button></div>
        </section>
        <section class="api-section">
          <div class="fnname">大总结时间轴化</div>
          <div class="flabel">API 连接（取自酒馆 Connection Profiles）</div>
          <div class="apirow"><div class="sel"><select data-el="timeline-connection-profile">${timelineOptions}</select><span class="chev">▾</span></div>
            <button class="save api-save" data-act="api-save-timeline">保存</button></div>
        </section>
        <div class="modelhint">只保存连接配置 ID；地址、密钥与代理密码均由酒馆内部读取。<br>${esc(session.config.modelHint)}</div>
      </div>`;
  }

  function renderIntegrity(): string {
    const ig = snap?.integrity;
    const items = (ig?.toRestore ?? [])
      .map(e => {
        const title = parseArchiveBody(e.content).map(c => c.title).filter(Boolean)[0] ?? '（无题）';
        return `<div class="item"><div class="itx"><div class="nm">${esc(title)}</div><div class="src">来源 层 ${e.messageId}</div></div><span class="old">退役 old_</span></div>`;
      })
      .join('');
    const p = snap?.previousFloor;
    const q = snap?.currentFloor ?? 0;
    const reason = snap?.floorsDecreased
      ? `聊天末层由上次记录的 ${p ?? '未知'} 减少至当前 ${q}`
      : `聊天仍为 ${q} 层；检测到生效归档或覆盖标记缺失`;
    return `
      <div class="top" style="align-items:flex-start"><span class="imk">!</span>
        <div><div class="htitle">档案完整性</div>
        <div class="hsub">${reason}</div></div>
        <span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        <div class="seclab">覆盖链缺口 · 建议复原层 ${ig?.lastMarkerFloor ?? -1} 之后</div>
        <div class="list">${items || '<div class="empty">没有需要复原的退役档</div>'}</div>
        <button class="gobtn" data-act="integrity-run">复原全部 ${ig?.toRestore.length ?? 0} 条</button>
      </div>`;
  }

  function renderCommitLog(): string {
    const log = snap?.commitLog ?? null;
    const interrupted = !!snap?.interrupted.length;
    if (!log) {
      return `
        <div class="top"><span class="back" data-act="home">‹</span><span class="htitle">提交事务日志</span><span class="grow"></span>${dnToggle()}</div>
        <div class="body">
          ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
          <div class="empty">还没有任何提交记录。完成一次「大总结时间轴化」后，这里会显示最近一笔提交的分步进度。</div>
        </div>`;
    }
    const fmt = (floors: number[]) => (floors.length ? floors.join('、') : '无');
    const badge = (done: boolean, ok: string, wait: string) =>
      done ? `<span class="okmk">✓ ${ok}</span>` : `<span class="womk">… ${wait}</span>`;
    const isDone = log.status === 'completed';
    const allOld = log.plannedOldFloors.every(f => log.oldSucceededFloors.includes(f));
    const rows = [
      `<div class="item"><div class="itx"><div class="nm">pending 写入目标层 ${log.targetFloor}</div><div class="src">覆盖端点 archived: ${log.through}</div></div>${badge(log.pendingWritten, '已写', '未写')}</div>`,
      `<div class="item"><div class="itx"><div class="nm">原始档退役 → old_</div><div class="src">已 old：${esc(fmt(log.oldSucceededFloors))} ／ 计划 ${esc(fmt(log.plannedOldFloors))}</div></div>${badge(allOld, '全退役', '未完')}</div>`,
      log.supersede
        ? `<div class="item"><div class="itx"><div class="nm">既存末容器接管（层 ${log.supersede.plannedFloor}）</div><div class="src">同名续写时冷存既存末尾容器</div></div>${badge(log.supersede.done, '已接管', '未接管')}</div>`
        : `<div class="item"><div class="itx"><div class="nm">既存末容器接管</div><div class="src">本次无同名增量覆写</div></div><span class="womk">— 无</span></div>`,
      `<div class="item"><div class="itx"><div class="nm">pending 转正 → live</div><div class="src">${log.promotedFloor == null ? '尚未转正' : `层 ${log.promotedFloor} 已转正`}</div></div>${badge(log.promotedFloor === log.targetFloor, '已转正', '未转正')}</div>`,
    ].join('');
    const doneNote = isDone
      ? `<div class="warnbar okbar" style="cursor:default">✓ 最近一笔提交已完成 · 目标层 ${log.targetFloor}</div>`
      : '';
    const errBar = log.error && !isDone
      ? `<div class="warnbar" style="cursor:default">最近错误：${esc(log.error)}</div>`
      : '';
    // 现场仍有孤立 pending，或日志停在「已写 pending 但未转正」的中断态 → 可一键续跑。
    const canResume = interrupted || (!isDone && log.pendingWritten && log.promotedFloor !== log.targetFloor);
    const resumeBtn = canResume
      ? `<button class="gobtn" data-act="commitlog-resume">一键继续未完成提交</button>`
      : '';
    return `
      <div class="top" style="align-items:flex-start">
        <span class="back" data-act="home">‹</span>
        <div><div class="htitle">提交事务日志</div>
        <div class="hsub" style="color:var(--mut)">${esc(COMMIT_STATUS_LABEL[log.status] ?? log.status)} · 事务 ${esc(log.txId)}</div></div>
        <span class="grow"></span>${dnToggle()}</div>
      <div class="body">
        ${flash ? `<div class="warnbar${flash.includes('✓') ? ' okbar' : ''}">${esc(flash)}</div>` : ''}
        ${doneNote}
        ${errBar}
        <div class="seclab">两段提交 · 分步进度</div>
        <div class="list">${rows}</div>
        ${resumeBtn}
      </div>`;
  }

  /** 提示词全屏编辑器（面板放大、大文本框铺满） */
  function renderFullEdit(): string {
    const fe = fullEdit!;
    const state = promptState(fe.scope, fe.id);
    const status = state.customized
      ? `<span class="prompttag custom">自定义</span>${state.builtinUpdateAvailable ? '<span class="prompttag update">内置有新版</span>' : ''}`
      : '<span class="prompttag">跟随内置</span>';
    return `
      <div class="top"><span class="back" data-act="full-cancel" title="退出全屏">‹</span><span class="htitle">${esc(fe.label)}</span>${status}<span class="grow"></span>${state.customized ? '<span class="headact" data-act="full-reset">使用内置最新版</span>' : ''}${dnToggle()}<span class="savem" data-act="full-save">保存</span></div>
      ${state.builtinUpdateAvailable ? `<div class="full-update-slot">${promptUpdateCard(fe.scope, fe.id)}</div>` : ''}
      <div class="fullwrap"><textarea class="fulltext" data-el="fulltext" spellcheck="false">${esc(fe.value)}</textarea></div>`;
  }

  function renderPromptComparison(): string {
    const comparison = promptComparison!;
    return `
      <div class="top"><span class="back" data-act="prompt-compare-back" title="返回">‹</span><span class="htitle">${esc(comparison.label)} · 查看内置新版</span><span class="grow"></span>${dnToggle()}</div>
      <div class="prompt-compare">
        <div class="compare-intro">这里只读对照，不会改动你的自定义提示词。选择“继续使用我的版本”后，本次新版提示会在所有聊天中消失。</div>
        <div class="compare-grid">
          <section class="compare-pane"><div class="compare-label"><b>我的自定义版本</b> · ${comparison.customIsDraft ? '当前未保存草稿' : '当前实际使用'}</div><pre class="compare-text">${esc(comparison.customContent)}</pre></section>
          <section class="compare-pane"><div class="compare-label"><b>内置新版</b> · 插件当前版本</div><pre class="compare-text">${esc(comparison.builtinContent)}</pre></section>
        </div>
        <div class="compare-footer">
          <button type="button" class="prompt-action" data-act="prompt-compare-back">暂不处理</button>
          <button type="button" class="prompt-action keep" data-act="prompt-keep-custom" data-prompt-scope="${comparison.scope}" data-prompt-id="${esc(comparison.id)}">继续使用我的版本</button>
          <button type="button" class="prompt-action use" data-act="prompt-use-builtin" data-prompt-scope="${comparison.scope}" data-prompt-id="${esc(comparison.id)}">使用内置新版</button>
        </div>
      </div>`;
  }

  function render() {
    // pending 的专门恢复优先级更高；否则完整性缺口必须先处理，不能绕回其他页面。
    if (snap?.interrupted.length && view === 'integrity') view = 'hub';
    if (snap?.integrity.needed && !snap.interrupted.length) {
      if (cand) {
        session.discard();
        cand = null;
      }
      if (summaryCand || failedSummaryGeneration) {
        session.discardSummary();
        summaryCand = null;
        failedSummaryGeneration = null;
      }
      view = 'integrity';
      fullEdit = null;
      promptComparison = null;
      expandMod = null;
      summaryExpandMod = null;
      editingIdx = null;
      candEditing = false;
      summaryCandEditing = false;
      reopenEditor = false;
      summaryReopenEditor = false;
    }
    if (view === 'result' && !cand) view = 'hub';
    if (view === 'summary-result' && !summaryCand) view = 'summary-setup';
    if (view === 'detail' && detailStart == null) view = 'timeline';
    const surface = promptComparison ? 'prompt-comparison' : fullEdit ? 'full-edit' : view;
    const surfaceChanged = surface !== renderedSurface;

    if (promptComparison) {
      panelEl.classList.add('full');
      panelEl.classList.remove('result');
      viewEl().innerHTML = renderPromptComparison();
      if (surfaceChanged) panelEl.scrollTop = 0;
      renderedSurface = surface;
      layoutPanel();
      return;
    }
    if (fullEdit) {
      panelEl.classList.add('full');
      panelEl.classList.remove('result');
      viewEl().innerHTML = renderFullEdit();
      if (surfaceChanged) panelEl.scrollTop = 0;
      renderedSurface = surface;
      layoutPanel();
      return;
    }
    panelEl.classList.remove('full');
    panelEl.classList.toggle('result', (view === 'result' && !!cand) || (view === 'summary-result' && !!summaryCand));
    const map: Record<View, () => string> = {
      hub: renderHub,
      setup: renderSetup,
      'summary-setup': renderSummarySetup,
      timeline: renderTimeline,
      detail: renderDetail,
      result: renderResult,
      'summary-result': renderSummaryResult,
      api: renderApi,
      integrity: renderIntegrity,
      commitlog: renderCommitLog,
    };
    viewEl().innerHTML = (map[view] ?? renderHub)();
    if (surfaceChanged) panelEl.scrollTop = 0;
    renderedSurface = surface;
    layoutPanel();
  }

  function showLoading(txt: string) {
    viewEl().innerHTML = `<div class="loading"><div>${esc(txt)}</div><button type="button" class="ghost" data-act="cancel-generation">取消生成</button></div>`;
  }

  // ---- 动作 ----------------------------------------------------------------

  async function runGenerationAttempt(attempt: GenerationAttempt): Promise<void> {
    const frozen: GenerationAttempt = {
      ...attempt,
      selection: attempt.selection ? [...attempt.selection] : undefined,
    };
    const epoch = ++generationUiEpoch;
    activeGenerationAttempt = frozen;
    failedGeneration = null;
    flash = '';
    candEditing = false;
    reopenEditor = false;
    showLoading(frozen.kind === 'initial' ? '生成中…（单次独立调用）' : '重新生成中…（从头整段重跑）');

    try {
      const next = frozen.kind === 'initial'
        ? await session.generate(snap!.table, frozen.guidance, frozen.selection)
        : await session.regenerate(snap!.table, frozen.guidance, frozen.selection);
      if (epoch !== generationUiEpoch) return;
      activeGenerationAttempt = null;
      failedGeneration = null;
      cand = next;
      mode = 'archive';
      view = 'result';
      render();
    } catch (error) {
      if (epoch !== generationUiEpoch) return;
      activeGenerationAttempt = null;
      if (error instanceof GenerationCancelledError) return;
      failedGeneration = { attempt: frozen, message: `生成失败：${(error as Error).message}` };
      if (frozen.kind === 'initial') {
        view = 'setup';
      } else if (cand) {
        // 旧候选仍可保存；同时让输入框保留这次失败时的 guidance。
        cand = { ...cand, guidance: frozen.guidance };
        view = 'result';
      }
      doRefresh();
      render();
    }
  }

  async function runSummaryGenerationAttempt(attempt: SummaryGenerationAttempt): Promise<void> {
    const frozen = { ...attempt };
    const previousCandidate = summaryCand;
    const epoch = ++generationUiEpoch;
    activeSummaryGenerationAttempt = frozen;
    failedSummaryGeneration = null;
    flash = '';
    summaryCandEditing = false;
    summaryReopenEditor = false;
    showLoading(
      frozen.kind === 'initial'
        ? '摘要 → 大总结生成中…（冻结本轮来源）'
        : frozen.kind === 'retry'
          ? '重试中…（复用同一批来源）'
          : '重新生成中…（同一批来源从头重跑）',
    );

    try {
      const next = frozen.kind === 'initial'
        ? await session.generateSummary(frozen.guidance)
        : frozen.kind === 'retry'
          ? await session.retrySummary(frozen.guidance)
          : await session.regenerateSummary(previousCandidate!, frozen.guidance);
      if (epoch !== generationUiEpoch) return;
      activeSummaryGenerationAttempt = null;
      failedSummaryGeneration = null;
      summaryCand = next;
      summaryMode = 'archive';
      view = 'summary-result';
      render();
    } catch (error) {
      if (epoch !== generationUiEpoch) return;
      activeSummaryGenerationAttempt = null;
      if (error instanceof GenerationCancelledError) return;
      failedSummaryGeneration = { attempt: frozen, message: `生成失败：${(error as Error).message}` };
      if (frozen.kind === 'reroll' && previousCandidate && session.phase === 'preview') {
        summaryCand = { ...previousCandidate, guidance: frozen.guidance };
        view = 'summary-result';
      } else {
        summaryCand = null;
        view = 'summary-setup';
      }
      doRefresh();
      render();
    }
  }

  function cancelGeneration(): void {
    const summaryAttempt = activeSummaryGenerationAttempt;
    if (summaryAttempt) {
      generationUiEpoch += 1;
      activeSummaryGenerationAttempt = null;
      session.cancel();
      if (summaryAttempt.kind === 'reroll') {
        view = 'summary-result';
        flash = '已取消重新生成，原候选仍保留';
      } else {
        failedSummaryGeneration = { attempt: summaryAttempt, message: '已取消生成' };
        view = 'summary-setup';
        flash = '';
      }
      doRefresh();
      render();
      return;
    }
    const attempt = activeGenerationAttempt;
    if (!attempt) return;
    generationUiEpoch += 1;
    activeGenerationAttempt = null;
    failedGeneration = null;
    session.cancel();
    view = attempt.kind === 'initial' ? 'setup' : 'result';
    flash = attempt.kind === 'initial' ? '已取消生成' : '已取消重新生成，原候选仍保留';
    doRefresh();
    render();
  }

  function retryGeneration(): void {
    const failed = failedGeneration;
    if (!failed) return;
    void runGenerationAttempt(failed.attempt);
  }

  async function startArchive() {
    doRefresh();
    if (snap!.interrupted.length || snap!.integrity.needed) {
      render();
      return;
    }
    const selection = selectedRangeFloors();
    if (selection.length === 0) {
      flash = '请至少勾选一份原始档';
      view = 'setup';
      render();
      return;
    }
    view = 'result';
    cand = null;
    await runGenerationAttempt({ kind: 'initial', guidance: '', selection });
  }

  async function startSummary() {
    doRefresh();
    if (snap!.interrupted.length || snap!.integrity.needed || session.phase !== 'idle') {
      render();
      return;
    }
    summaryCand = null;
    view = 'summary-result';
    await runSummaryGenerationAttempt({ kind: 'initial', guidance: '' });
  }

  function retrySummaryGeneration() {
    if (!failedSummaryGeneration || !session.summaryRetryAvailable()) return;
    const guidance = (shadow.querySelector('[data-el=summary-retry-guide]') as HTMLInputElement | null)?.value ?? '';
    void runSummaryGenerationAttempt({ kind: 'retry', guidance });
  }

  async function reroll() {
    const g = (shadow.querySelector('[data-el=guide]') as HTMLInputElement | null)?.value ?? '';
    const selection = cand?.selection ? [...cand.selection] : undefined;
    await runGenerationAttempt({ kind: 'reroll', guidance: g, selection });
  }

  async function rerollSummary() {
    if (!summaryCand) return;
    const guidance = (shadow.querySelector('[data-el=summary-guide]') as HTMLInputElement | null)?.value ?? '';
    await runSummaryGenerationAttempt({ kind: 'reroll', guidance });
  }

  function applyEdit() {
    const ta = shadow.querySelector('[data-el=editdoc]') as HTMLTextAreaElement | null;
    if (!cand || !ta) return;
    cand = session.editCandidate(cand, ta.value);
    candEditing = false;
    render();
  }

  function applySummaryEdit() {
    const ta = shadow.querySelector('[data-el=summary-editdoc]') as HTMLTextAreaElement | null;
    if (!summaryCand || !ta) return;
    summaryCand = session.editSummaryCandidate(summaryCand, ta.value);
    summaryCandEditing = false;
    render();
  }

  /** 从结构化编辑器 DOM 收集出一个 Container（结构符号是锁定的，不参与收集） */
  function collectStructured(root: HTMLElement, kind: Container['kind']): Container {
    const inline = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const block = (el: Element | null) =>
      ((el as HTMLElement | null)?.innerText ?? el?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return {
      kind,
      title: inline(root.querySelector('[data-f=title]')),
      time: inline(root.querySelector('[data-f=time]')) || null,
      keywords: kind === 'segment' ? inline(root.querySelector('[data-f=keywords]')) || null : null,
      summary: block(root.querySelector('[data-f=summary]')),
      fragments: [...root.querySelectorAll('.se-frag')].map(fr => ({
        title: inline(fr.querySelector('[data-ff=title]')),
        time: inline(fr.querySelector('[data-ff=time]')) || null,
        summary: block(fr.querySelector('[data-ff=summary]')),
        excerpts: [...fr.querySelectorAll('.se-excs .f.line')].map(el => ({ text: inline(el) })).filter(x => x.text),
      })),
      looseExcerpts: [...(root.querySelector('.se-loose')?.querySelectorAll('.f.line') ?? [])]
        .map(el => ({ text: inline(el) }))
        .filter(x => x.text),
    };
  }

  async function saveContainerEdit() {
    if (editingIdx == null) return;
    const node = nodes[editingIdx];
    const root = shadow.querySelector('.se-root') as HTMLElement | null;
    if (!node || !root) return;
    const container = collectStructured(root, node.container.kind);
    const text = serializeContainers([container]);
    const floor = node.floor;
    const archiveRaw = node.archiveRaw;
    const li = node.localIndex;
    try {
      await session.editLiveContainer(floor, archiveRaw, li, text);
      doRefresh();
      nodes = buildNodes();
      editingIdx = null;
      flash = '已保存 ✓';
      render();
    } catch (e) {
      flash = '保存失败：' + (e as Error).message;
      render();
    }
  }

  /** 返回时间轴并滚到指定容器的位置（详情页返回定位用；停在 sticky 抬头正下方） */
  function goTimelineAt(idx: number) {
    view = 'timeline';
    editingIdx = null;
    flash = '';
    render();
    // scrollIntoView + scroll-margin-top（.ev 上设了）→ 原生对齐到抬头下方，天然处理边界/时机
    (shadow.querySelector(`.ev .card[data-i="${idx}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'start' });
  }

  /** 详情页滚到某容器：让它停在 sticky 抬头正下方（进入详情 / 落点定位用） */
  function scrollDetailTo(idx: number) {
    (shadow.querySelector(`.read [data-cidx="${idx}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'start' });
  }

  async function save() {
    if (!cand || !snap) return;
    if (candEditing) {
      flash = '请先应用或取消正在编辑的内容';
      render();
      return;
    }
    if (!cand.validation.ok) {
      flash = '有硬错，先改或重生成';
      render();
      return;
    }
    showLoading('两段提交中…');
    try {
      const promotedFloor = cand.through;
      await session.commit(cand, snap.table);
      cand = null;
      view = 'hub';
      flash = `已归档 ✓ · 层 ${promotedFloor} pending 已转为正式 archive`;
      doRefresh();
      render();
    } catch (e) {
      flash = '提交失败：' + (e as Error).message;
      doRefresh();
      render();
    }
  }

  async function applySummaryCandidate() {
    if (!summaryCand) return;
    if (summaryCandEditing) {
      flash = '请先应用或取消正在编辑的内容';
      render();
      return;
    }
    if (!summaryCand.validation.ok) {
      flash = '有硬错，先改或重新生成';
      render();
      return;
    }
    showLoading('应用摘要 → 大总结中…');
    try {
      const floor = await session.applySummary(summaryCand);
      summaryCand = null;
      failedSummaryGeneration = null;
      view = 'hub';
      flash = `摘要 → 大总结已应用 ✓ · 层 ${floor}`;
      doRefresh();
      render();
    } catch (error) {
      flash = `应用失败：${(error as Error).message}`;
      // y 缺失或已被正文占用时 session 会主动废止旧轮；旧候选不能继续应用或重跑。
      if (session.phase === 'idle') {
        summaryCand = null;
        failedSummaryGeneration = null;
        view = 'summary-setup';
      }
      doRefresh();
      render();
    }
  }

  function discardSummaryFlow() {
    generationUiEpoch += 1;
    activeSummaryGenerationAttempt = null;
    failedSummaryGeneration = null;
    session.discardSummary();
    summaryCand = null;
    summaryCandEditing = false;
    summaryReopenEditor = false;
    view = 'hub';
    flash = '';
    doRefresh();
    render();
  }

  async function integrityRun() {
    if (!snap?.integrity.needed) return;
    showLoading('复原退役档中…');
    try {
      await session.integrityRestore(snap.integrity.toRestore);
      session.discard();
      cand = null;
      candEditing = false;
      view = 'hub';
      flash = '已复原 ✓';
      doRefresh();
      render();
    } catch (e) {
      flash = '复原失败：' + (e as Error).message;
      doRefresh();
      render();
    }
  }

  async function commitLogResume() {
    viewEl().innerHTML = `<div class="loading"><div>继续未完成的提交…</div></div>`;
    try {
      const r = await session.resumeCommit();
      cand = null;
      candEditing = false;
      view = 'hub';
      flash = r.resumed
        ? r.steps > 0
          ? '已继续并完成提交 ✓'
          : '已据现场收尾并完成 ✓'
        : '无待完成的提交，已清理记录 ✓';
      doRefresh();
      render();
    } catch (e) {
      flash = '继续提交失败：' + (e as Error).message;
      doRefresh();
      render();
    }
  }

  function setNFromInput() {
    const el = shadow.querySelector('[data-el=nval]') as HTMLInputElement | null;
    if (!el) return;
    const v = parseInt(el.value, 10);
    if (Number.isFinite(v)) session.setN(v);
  }

  function setSummaryIntervalFromInput() {
    const el = shadow.querySelector('[data-el=summary-interval]') as HTMLInputElement | null;
    if (!el) return;
    const value = parseInt(el.value, 10);
    if (Number.isFinite(value)) session.setSummaryInterval(value);
  }

  function saveMod(which: 'pre' | 'post') {
    shadow.querySelectorAll(`.mod[data-mod="${which}"] textarea[data-oid]`).forEach(el => {
      const ta = el as HTMLTextAreaElement;
      session.setOrchestrationOverride(ta.dataset.oid!, ta.value);
    });
    clearInlinePromptDraft('archive');
    expandMod = null;
    flash = `${which === 'pre' ? '前置' : '后置'}提示词已保存 ✓`;
    render();
    setTimeout(() => {
      if (flash.includes('提示词已保存')) {
        flash = '';
        if (view === 'setup') render();
      }
    }, 1600);
  }

  function saveSummaryMod(which: 'pre' | 'post') {
    shadow.querySelectorAll(`[data-summary-mod="${which}"] textarea[data-soid]`).forEach(element => {
      const textarea = element as HTMLTextAreaElement;
      session.setSummaryOrchestrationOverride(textarea.dataset.soid as SummaryPromptId, textarea.value);
    });
    clearInlinePromptDraft('summary');
    summaryExpandMod = null;
    flash = `${which === 'pre' ? '前置定义' : '后置思考与输出'}已保存 ✓`;
    render();
    setTimeout(() => {
      if (flash.includes('已保存')) {
        flash = '';
        if (view === 'summary-setup') render();
      }
    }, 1600);
  }

  function openPromptComparison(scope: PromptScope, id: string): void {
    const builtin = scope === 'summary'
      ? session.builtinSummaryOrchestrationEntry(id as SummaryPromptId)
      : session.builtinOrchestrationEntry(id);
    const effective = scope === 'summary'
      ? session.summaryOrchestrationEntries().find(entry => entry.id === id)
      : session.orchestrationEntries().find(entry => entry.id === id);
    if (!builtin || !effective) return;

    const capturedDraft = capturePromptDraft(scope, id);
    const returnEdit = fullEdit?.scope === scope && fullEdit.id === id ? { ...fullEdit } : null;
    const customContent = capturedDraft ?? effective.content;
    promptComparison = {
      scope,
      id,
      label: effective.label,
      customContent,
      customIsDraft: capturedDraft !== null && capturedDraft !== effective.content,
      builtinContent: builtin.content,
      returnEdit,
    };
    fullEdit = null;
    render();
  }

  function acknowledgePromptUpdate(scope: PromptScope, id: string): void {
    if (!promptComparison) capturePromptDraft(scope, id);
    if (scope === 'summary') session.acknowledgeSummaryOrchestrationBuiltin(id as SummaryPromptId);
    else session.acknowledgeOrchestrationBuiltin(id);
    const returnEdit = promptComparison?.returnEdit ?? null;
    promptComparison = null;
    if (returnEdit) fullEdit = returnEdit;
    flash = '已继续使用自定义版本；本次新版已确认 ✓';
    render();
  }

  function useBuiltinPrompt(scope: PromptScope, id: string): void {
    if (scope === 'summary') session.resetSummaryOrchestrationOverride(id as SummaryPromptId);
    else session.resetOrchestrationOverride(id);
    promptComparison = null;
    fullEdit = null;
    clearInlinePromptDraft(scope, id);
    if (scope === 'summary') summaryExpandMod = null;
    else expandMod = null;
    flash = '已切换为内置最新版 ✓';
    render();
  }

  function closePromptComparison(): void {
    const returnEdit = promptComparison?.returnEdit ?? null;
    promptComparison = null;
    fullEdit = returnEdit;
    render();
  }

  // ---- 事件委托 ------------------------------------------------------------

  // 面板是一层密封表面：内部的指针/触摸/滚轮/键盘事件一律挡在宿主边界，绝不冒泡到酒馆。
  // 否则在面板上拖动或点按会被酒馆的消息 swipe / 快捷键手势接住，凭空生成新回复（用户反馈：
  // 面板上点点点，聊天却像被 swipe 了一样开始生成——截图里的 4/4 › 正是新 swipe）。
  // 监听挂在宿主（light DOM）冒泡阶段：shadow 内部自己的处理器先跑完，再在此截停外泄；
  // 指针/点击类必须走冒泡（capture 截停会掐掉面板自己的按钮/拖动处理器）。
  for (const sealedType of [
    'pointerdown', 'pointerup', 'pointermove', 'pointercancel',
    'touchstart', 'touchmove', 'touchend', 'touchcancel',
    'mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'contextmenu',
    'wheel', 'keydown', 'keyup', 'keypress',
  ]) {
    root.addEventListener(sealedType, e => e.stopPropagation());
  }

  // 冒泡密封只挡得住酒馆挂在冒泡阶段的监听；酒馆的**键盘快捷键 / 右键菜单**走 capture 阶段
  // （方向键翻页、右键弹菜单就是这类），在事件冒泡回宿主之前就已触发，冒泡密封拦不住。
  // 补一层 window capture（最外层、最先触发）：凡是面板内发起的键盘/右键事件，在此抢先截停，
  // 赶在酒馆 capture 处理器之前。实测 stopPropagation 不影响文本框的输入/光标等**默认行为**
  // （它们不靠监听、靠 target 默认动作），且面板本身不依赖任何键盘/右键监听，故安全。
  const removeCaptureSeal = bindPanelCaptureSeal(panelWindow, root);

  const dragBlocker = 'button,[data-act],.daynight,.dn,input,textarea,select,a,[contenteditable="true"]';
  shadow.addEventListener('pointerdown', rawEvent => {
    const ev = rawEvent as PointerEvent;
    const target = ev.target as HTMLElement | null;
    const handle = target?.closest?.('.head,.top') as HTMLElement | null;
    if (!handle || target?.closest?.(dragBlocker)) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;

    layoutPanel();
    drag = {
      pointerId: ev.pointerId,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      startOffsetX: panelOffset.x,
      startOffsetY: panelOffset.y,
      handle,
    };
    panelEl.classList.add('dragging');
    try {
      handle.setPointerCapture?.(ev.pointerId);
    } catch {
      // 少数旧 WebView 不支持 pointer capture；事件仍可在面板范围内继续拖动。
    }
    ev.preventDefault();
  });

  shadow.addEventListener('pointermove', rawEvent => {
    const ev = rawEvent as PointerEvent;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    panelOffset = {
      x: drag.startOffsetX + ev.clientX - drag.startClientX,
      y: drag.startOffsetY + ev.clientY - drag.startClientY,
    };
    panelMoved = true;
    layoutPanel();
    ev.preventDefault();
  });

  function finishDrag(rawEvent: Event): void {
    const ev = rawEvent as PointerEvent;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    const handle = drag.handle;
    drag = null;
    panelEl.classList.remove('dragging');
    try {
      if (handle.hasPointerCapture?.(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    } catch {
      // pointer capture 可能已随视图重绘释放，无需额外处理。
    }
  }

  shadow.addEventListener('pointerup', finishDrag);
  shadow.addEventListener('pointercancel', finishDrag);
  shadow.addEventListener('lostpointercapture', finishDrag);
  panelWindow.addEventListener('pointerup', finishDrag);
  panelWindow.addEventListener('pointercancel', finishDrag);

  shadow.addEventListener('click', ev => {
    const t = ev.target as HTMLElement;
    const dn = t.closest?.('.dn') as HTMLElement | null;
    if (dn) {
      night = dn.dataset.t === 'night';
      wrap.classList.toggle('night', night);
      shadow.querySelectorAll('.dn').forEach(x => x.classList.remove('on'));
      dn.classList.add('on');
      return;
    }
    const el = t.closest?.('[data-act]') as HTMLElement | null;
    const act = el?.getAttribute('data-act');
    if (!act) return;
    switch (act) {
      case 'close':
        close();
        break;
      case 'home':
        view = 'hub';
        flash = '';
        expandMod = null;
        summaryExpandMod = null;
        clearInlinePromptDraft();
        editingIdx = null;
        doRefresh();
        render();
        break;
      case 'timeline':
        view = 'timeline';
        flash = '';
        editingIdx = null;
        render();
        break;
      case 'toggle-retired':
        showRetired = !showRetired;
        render();
        break;
      case 'detail':
        detailStart = Number(el!.dataset.i);
        detailCurIdx = detailStart;
        editingIdx = null;
        view = 'detail';
        flash = '';
        render();
        scrollDetailTo(detailStart); // 落点停在点中的那条
        break;
      case 'back-timeline':
        goTimelineAt(detailCurIdx ?? detailStart ?? 0);
        break;
      case 'edit-container':
        editingIdx = Number(el!.dataset.i);
        flash = '';
        render();
        break;
      case 'full-open': {
        const oid = el!.dataset.oid!;
        const scope = el!.dataset.scope === 'summary' ? 'summary' : 'archive';
        const entry = scope === 'summary'
          ? session.summaryOrchestrationEntries().find(x => x.id === oid)
          : session.orchestrationEntries().find(x => x.id === oid);
        const ta = shadow.querySelector(
          `.modedit textarea[${scope === 'summary' ? 'data-soid' : 'data-oid'}="${oid}"]`,
        ) as HTMLTextAreaElement | null;
        fullEdit = { scope, id: oid, label: entry?.label ?? '提示词', value: ta?.value ?? entry?.content ?? '' };
        clearInlinePromptDraft(scope, oid);
        flash = '';
        render();
        break;
      }
      case 'full-save': {
        const ta = shadow.querySelector('[data-el=fulltext]') as HTMLTextAreaElement | null;
        if (fullEdit && ta) {
          if (fullEdit.scope === 'summary') {
            session.setSummaryOrchestrationOverride(fullEdit.id as SummaryPromptId, ta.value);
          } else {
            session.setOrchestrationOverride(fullEdit.id, ta.value);
          }
        }
        if (fullEdit) clearInlinePromptDraft(fullEdit.scope, fullEdit.id);
        fullEdit = null;
        flash = '提示词已保存 ✓';
        render();
        break;
      }
      case 'full-reset':
        if (fullEdit) {
          if (fullEdit.scope === 'summary') {
            session.resetSummaryOrchestrationOverride(fullEdit.id as SummaryPromptId);
          } else {
            session.resetOrchestrationOverride(fullEdit.id);
          }
          clearInlinePromptDraft(fullEdit.scope, fullEdit.id);
        }
        fullEdit = null;
        flash = '已恢复内置最新版 ✓';
        render();
        break;
      case 'full-cancel':
        if (fullEdit) clearInlinePromptDraft(fullEdit.scope, fullEdit.id);
        fullEdit = null;
        flash = '';
        render();
        break;
      case 'prompt-view-builtin':
        openPromptComparison(
          el!.dataset.promptScope === 'summary' ? 'summary' : 'archive',
          el!.dataset.promptId!,
        );
        break;
      case 'prompt-keep-custom':
        acknowledgePromptUpdate(
          el!.dataset.promptScope === 'summary' ? 'summary' : 'archive',
          el!.dataset.promptId!,
        );
        break;
      case 'prompt-use-builtin':
        useBuiltinPrompt(
          el!.dataset.promptScope === 'summary' ? 'summary' : 'archive',
          el!.dataset.promptId!,
        );
        break;
      case 'prompt-compare-back':
        closePromptComparison();
        break;
      case 'cedit-save':
        void saveContainerEdit();
        break;
      case 'cedit-cancel':
        editingIdx = null;
        flash = '';
        render();
        break;
      case 'exc-del':
        el!.closest('.se-exc')?.remove();
        break;
      case 'exc-add': {
        const excs = el!.closest('.se-frag')?.querySelector('.se-excs');
        excs?.insertAdjacentHTML('beforeend', excRow(''));
        (excs?.querySelector('.se-exc:last-child .f.line') as HTMLElement | null)?.focus();
        break;
      }
      case 'exc-add-loose':
        el!.insertAdjacentHTML('beforebegin', excRow(''));
        (el!.previousElementSibling?.querySelector('.f.line') as HTMLElement | null)?.focus();
        break;
      case 'api':
        view = 'api';
        flash = '';
        render();
        break;
      case 'toggle-summary':
        ev.stopPropagation();
        session.setSummaryEnabled(session.config.summaryEnabled === false);
        render();
        break;
      case 'toggle-timeline':
        ev.stopPropagation();
        session.setTimelineEnabled(session.config.timelineEnabled === false);
        render();
        break;
      case 'setup':
        view = 'setup';
        flash = '';
        expandMod = null;
        clearInlinePromptDraft();
        doRefresh();
        resetRangeSelection();
        render();
        break;
      case 'summary-setup':
        view = 'summary-setup';
        flash = '';
        summaryExpandMod = null;
        clearInlinePromptDraft();
        doRefresh();
        render();
        break;
      case 'integrity-open':
        view = 'integrity';
        render();
        break;
      case 'integrity-run':
        void integrityRun();
        break;
      case 'commitlog-open':
        view = 'commitlog';
        flash = '';
        doRefresh();
        render();
        break;
      case 'commitlog-resume':
        void commitLogResume();
        break;
      case 'run':
        void startArchive();
        break;
      case 'summary-run':
        void startSummary();
        break;
      case 'cancel-generation':
        cancelGeneration();
        break;
      case 'retry-generation':
        retryGeneration();
        break;
      case 'summary-retry':
        retrySummaryGeneration();
        break;
      case 'summary-failed-discard':
        discardSummaryFlow();
        break;
      case 'range-all':
        resetRangeSelection();
        render();
        break;
      case 'range-none':
        rangeThrough = null;
        render();
        break;
      case 'n-dec':
        setNFromInput();
        session.setN(session.config.n - 50);
        doRefresh();
        resetRangeSelection();
        render();
        break;
      case 'n-inc':
        setNFromInput();
        session.setN(session.config.n + 50);
        doRefresh();
        resetRangeSelection();
        render();
        break;
      case 'summary-interval-dec':
        setSummaryIntervalFromInput();
        session.setSummaryInterval(session.config.summaryInterval - 10);
        doRefresh();
        render();
        break;
      case 'summary-interval-inc':
        setSummaryIntervalFromInput();
        session.setSummaryInterval(session.config.summaryInterval + 10);
        doRefresh();
        render();
        break;
      case 'mod-toggle': {
        const m = el!.dataset.mod as 'pre' | 'runtime' | 'post';
        clearInlinePromptDraft('archive');
        expandMod = expandMod === m ? null : m;
        render();
        break;
      }
      case 'mod-cancel':
        clearInlinePromptDraft('archive');
        expandMod = null;
        render();
        break;
      case 'mod-reset':
        clearInlinePromptDraft('archive', el!.dataset.oid!);
        session.resetOrchestrationOverride(el!.dataset.oid!);
        flash = '已恢复内置最新版 ✓';
        render();
        break;
      case 'mod-save':
        saveMod(el!.dataset.mod as 'pre' | 'post');
        break;
      case 'prompt-reset-all':
        session.resetAllOrchestrationOverrides();
        clearInlinePromptDraft('archive');
        expandMod = null;
        fullEdit = null;
        flash = '已全部使用内置最新版 ✓';
        render();
        break;
      case 'summary-mod-toggle': {
        const mod = el!.dataset.mod as 'pre' | 'runtime' | 'post';
        clearInlinePromptDraft('summary');
        summaryExpandMod = summaryExpandMod === mod ? null : mod;
        render();
        break;
      }
      case 'summary-mod-cancel':
        clearInlinePromptDraft('summary');
        summaryExpandMod = null;
        render();
        break;
      case 'summary-mod-reset':
        clearInlinePromptDraft('summary', el!.dataset.oid!);
        session.resetSummaryOrchestrationOverride(el!.dataset.oid as SummaryPromptId);
        flash = '已恢复内置最新版 ✓';
        render();
        break;
      case 'summary-mod-save':
        saveSummaryMod(el!.dataset.mod as 'pre' | 'post');
        break;
      case 'summary-prompt-reset-all':
        session.resetAllSummaryOrchestrationOverrides();
        clearInlinePromptDraft('summary');
        summaryExpandMod = null;
        fullEdit = null;
        flash = '已全部使用内置最新版 ✓';
        render();
        break;
      case 'api-save-summary': {
        const sel = shadow.querySelector('[data-el=summary-connection-profile]') as HTMLSelectElement | null;
        session.setSummaryConnectionProfile(sel?.value ?? null);
        flash = '摘要 → 大总结 API 已保存 ✓';
        render();
        break;
      }
      case 'api-save-timeline': {
        const sel = shadow.querySelector('[data-el=timeline-connection-profile]') as HTMLSelectElement | null;
        session.setTimelineConnectionProfile(sel?.value ?? null);
        flash = '大总结时间轴化 API 已保存 ✓';
        render();
        break;
      }
      case 'discard':
        session.discard();
        generationUiEpoch += 1;
        activeGenerationAttempt = null;
        failedGeneration = null;
        cand = null;
        candEditing = false;
        reopenEditor = false;
        view = 'hub';
        flash = '';
        doRefresh();
        render();
        break;
      case 'summary-discard':
        discardSummaryFlow();
        break;
      case 'mode-archive':
        mode = 'archive';
        // 从调试切回：若刚才在编辑，直接重开编辑器，草稿已并入候选、原样还在。
        if (reopenEditor) {
          candEditing = true;
          reopenEditor = false;
        } else {
          candEditing = false;
        }
        render();
        break;
      case 'mode-debug': {
        // 切到调试前先把正在编辑的草稿并入候选，别让「看一眼」把改动丢了。
        if (candEditing) {
          const ta = shadow.querySelector('[data-el=editdoc]') as HTMLTextAreaElement | null;
          if (ta && cand) cand = session.editCandidate(cand, ta.value);
          reopenEditor = true;
        } else {
          reopenEditor = false;
        }
        mode = 'debug';
        candEditing = false;
        render();
        break;
      }
      case 'summary-mode-archive':
        summaryMode = 'archive';
        if (summaryReopenEditor) {
          summaryCandEditing = true;
          summaryReopenEditor = false;
        } else {
          summaryCandEditing = false;
        }
        render();
        break;
      case 'summary-mode-debug': {
        if (summaryCandEditing) {
          const ta = shadow.querySelector('[data-el=summary-editdoc]') as HTMLTextAreaElement | null;
          if (ta && summaryCand) summaryCand = session.editSummaryCandidate(summaryCand, ta.value);
          summaryReopenEditor = true;
        } else {
          summaryReopenEditor = false;
        }
        summaryMode = 'debug';
        summaryCandEditing = false;
        render();
        break;
      }
      case 'edit-doc':
        if (mode === 'archive') {
          candEditing = true;
          render();
        }
        break;
      case 'edit-save':
        applyEdit();
        break;
      case 'edit-cancel':
        candEditing = false;
        render();
        break;
      case 'summary-edit-doc':
        if (summaryMode === 'archive') {
          summaryCandEditing = true;
          render();
        }
        break;
      case 'summary-edit-save':
        applySummaryEdit();
        break;
      case 'summary-edit-cancel':
        summaryCandEditing = false;
        render();
        break;
      case 'repair': {
        if (!cand || candEditing) break;
        const repaired = session.repairCandidate(cand);
        if (!repaired.fixes.length) {
          flash = '没有可安全自动补正的结构';
        } else {
          cand = repaired.candidate;
          mode = 'archive';
          flash = `已补正：${repaired.fixes.join('；')} ✓`;
        }
        render();
        break;
      }
      case 'reroll':
        void reroll();
        break;
      case 'save':
        void save();
        break;
      case 'summary-reroll':
        void rerollSummary();
        break;
      case 'summary-apply':
        void applySummaryCandidate();
        break;
    }
  });

  // 数字设置输入框直接改
  shadow.addEventListener('change', ev => {
    const t = ev.target as HTMLElement;
    if (t.matches?.('[data-el=nval]')) {
      setNFromInput();
      doRefresh();
      resetRangeSelection();
      render();
    } else if (t.matches?.('[data-el=summary-interval]')) {
      setSummaryIntervalFromInput();
      doRefresh();
      render();
    } else if (t.matches?.('[data-el=range-floor]')) {
      const input = t as HTMLInputElement;
      const floor = Number(input.value);
      const floors = rangeSources().map(x => x.floor);
      if (input.checked) {
        rangeThrough = floor; // 勾某层 = 自动勾齐此前全部
      } else {
        rangeThrough = floors.filter(x => x < floor).pop() ?? null; // 取消某层 = 该层及其后全部取消
      }
      render();
    }
  });

  // 结果页/失败页会因模式切换或设置变化重绘；输入时就把 Guidance 草稿同步回内存，
  // 避免用户刚写的重跑引导在一次 render 后消失。
  shadow.addEventListener('input', ev => {
    const target = ev.target as HTMLInputElement;
    if (target.matches?.('[data-el=summary-guide]') && summaryCand) {
      summaryCand = { ...summaryCand, guidance: target.value };
    } else if (target.matches?.('[data-el=summary-retry-guide]') && failedSummaryGeneration) {
      failedSummaryGeneration = {
        ...failedSummaryGeneration,
        attempt: { ...failedSummaryGeneration.attempt, guidance: target.value },
      };
    }
  });

  // 详情页滚动联动：sticky 抬头标题随滚到的容器切换、记住当前容器（返回定位用）
  const panelScroll = panelEl;
  panelScroll.addEventListener('scroll', () => {
    if (view !== 'detail') return;
    const cards = [...shadow.querySelectorAll('.read [data-cidx]')] as HTMLElement[];
    if (!cards.length) return;
    const ptop = panelScroll.getBoundingClientRect().top;
    const headH = (shadow.querySelector('.top') as HTMLElement | null)?.getBoundingClientRect().height ?? 48;
    let cur = cards[0];
    for (const c of cards) {
      if (c.getBoundingClientRect().top - ptop <= headH + 14) cur = c;
      else break;
    }
    const idx = Number(cur.getAttribute('data-cidx'));
    if (idx === detailCurIdx) return;
    detailCurIdx = idx;
    const now = shadow.querySelector('.now') as HTMLElement | null;
    if (now) {
      now.textContent = cur.getAttribute('data-cname') || '（无题）';
      const ctime = cur.getAttribute('data-ctime') || '';
      if (ctime) {
        const s = doc.createElement('small');
        s.textContent = ctime;
        now.append(' ', s);
      }
    }
  });

  function open() {
    if (destroyed) return;
    generationUiEpoch += 1;
    activeGenerationAttempt = null;
    failedGeneration = null;
    activeSummaryGenerationAttempt = null;
    failedSummaryGeneration = null;
    root.style.display = 'block';
    panelOffset = { x: 0, y: 0 };
    panelMoved = false;
    renderedSurface = null;
    view = 'hub';
    cand = null;
    summaryCand = null;
    detailStart = null;
    detailCurIdx = null;
    editingIdx = null;
    candEditing = false;
    reopenEditor = false;
    summaryCandEditing = false;
    summaryReopenEditor = false;
    expandMod = null;
    summaryExpandMod = null;
    fullEdit = null;
    inlinePromptDraft = null;
    promptComparison = null;
    rangeThrough = null;
    flash = '';
    doRefresh();
    render();
    layoutPanel(true);
  }
  function close() {
    if (destroyed) return;
    // 提交正在逐楼层落盘时不能中途拆掉会话；通常只有极短一瞬。
    if (session.phase === 'committing') return;
    generationUiEpoch += 1;
    activeGenerationAttempt = null;
    failedGeneration = null;
    activeSummaryGenerationAttempt = null;
    failedSummaryGeneration = null;
    root.style.display = 'none';
    inlinePromptDraft = null;
    promptComparison = null;
    fullEdit = null;
    session.cancel();
    session.discard();
    session.discardSummary();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    generationUiEpoch += 1;
    activeGenerationAttempt = null;
    failedGeneration = null;
    activeSummaryGenerationAttempt = null;
    failedSummaryGeneration = null;
    try {
      if (session.phase !== 'committing') {
        session.cancel();
        session.discard();
        session.discardSummary();
      }
    } finally {
      // 即使会话清理意外失败，也必须断开 window 对面板闭包的强引用。
      panelWindow.removeEventListener('resize', onViewportChange);
      panelWindow.visualViewport?.removeEventListener('resize', onViewportChange);
      panelWindow.visualViewport?.removeEventListener('scroll', onViewportChange);
      panelWindow.removeEventListener('pointerup', finishDrag);
      panelWindow.removeEventListener('pointercancel', finishDrag);
      removeCaptureSeal();
      root.remove();
    }
  }

  return { root, open, close, destroy };
}
