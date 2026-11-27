import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, props, closeOverlay, layout, panes, focused, settings, shared, appHome, window } from "herdr";
import { mkdir, writeFile } from "fs/promises";

const DRAG = 4;
const COLORS = ["#ff3b30", "#ff9500", "#34c759", "#0a84ff", "#af52de", "#ff2d55"];
const FOR_CLAUDE = [
  "c-shot 的標記結果。image 是 herdr 視窗截圖，上面畫著編號標記。",
  "座標是視窗的 logical px，原點在左上角。截圖是實體像素：image 寬 ÷ window.width 就是倍率。",
  "marks[].at 是標記中心落在哪個 layout 區塊。點的標記另有 region：那個區塊的範圍，截圖上用虛線框畫出。regions 是依 layout 推算的區塊位置，可能有幾 px 誤差，以截圖為準。",
  "要改 mod 的話，mod 原始碼在 ~/.config/herdr-app/mods/<mod>/ 或這個 repo 的 mods/<mod>/。",
];

function color(n) {
  return COLORS[(n - 1) % COLORS.length];
}

function stamp(d) {
  const p = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function regions(width, height) {
  const zoom = Number(settings()?.zoom) || 1;
  const out = [];
  walk(layout(), { x: 0, y: 0, w: width, h: height }, [], out, zoom);
  return out;
}

function walk(node, box, path, out, zoom) {
  if (!node || typeof node !== "object" || node.hidden) return;
  const here = [...path, node.id ?? node.type ?? "?"];
  const content = node.content ?? {};
  out.push({
    path: here.join(" › "),
    mod: content.mod ?? null,
    terminals: Boolean(content.tab || content.pane || content.terminal),
    x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h),
  });
  const kids = (node.children ?? []).filter((k) => k && !k.hidden);
  if (node.type === "stack") {
    walk(kids.find((k) => k.id === node.active) ?? kids[0], box, here, out, zoom);
    return;
  }
  if (node.type !== "row" && node.type !== "column") return;
  const row = node.type === "row";
  const pad = (typeof node.padding === "number" ? node.padding : 0) * zoom;
  const gap = (typeof node.gap === "number" ? node.gap : 0) * zoom;
  const inner = { x: box.x + pad, y: box.y + pad, w: box.w - 2 * pad, h: box.h - 2 * pad };
  const total = (row ? inner.w : inner.h) - gap * Math.max(0, kids.length - 1);
  const fixed = kids.map((k) => (typeof k.size?.px === "number" ? k.size.px * zoom : null));
  const left = Math.max(0, total - fixed.reduce((s, v) => s + (v ?? 0), 0));
  const weights = kids.map((k, i) => (fixed[i] === null ? k.size?.weight ?? 1 : 0));
  const sum = weights.reduce((s, v) => s + v, 0) || 1;
  let at = row ? inner.x : inner.y;
  kids.forEach((k, i) => {
    const len = fixed[i] ?? (left * weights[i]) / sum;
    walk(k, row ? { x: at, y: inner.y, w: len, h: inner.h } : { x: inner.x, y: at, w: inner.w, h: len }, here, out, zoom);
    at += len + gap;
  });
}

function hit(list, x, y) {
  let best = null;
  for (const r of list) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) best = r;
  }
  return best;
}

function label(r) {
  if (!r) return "（不明）";
  const name = r.path.split(" › ").pop();
  if (r.mod) return `${r.mod} mod（${name}）`;
  if (r.terminals) return `終端機區（${name}）`;
  return name;
}

function tabPanes() {
  const tab = focused()?.tab;
  return panes().filter((p) => p.tab === tab).map((p) => ({
    pane: p.pane, mod: p.mod ?? null, title: p.title, name: p.name, program: p.program?.name ?? null,
    cwd: p.cwd, focused: p.focused,
  }));
}

export default class Shot extends View {
  init(_props, cx) {
    this.size = { width: 0, height: 0 };
    this.list = [];
    this.pointer = null;
    this.origin = { x: 0, y: 0 };
    this.drag = null;
    this.marks = [];
    this.busy = false;
    this.error = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(100, () => this.handle.focus());
  }

  close() {
    closeOverlay(props().overlay);
  }

  resized(size, cx) {
    this.size = size;
    this.list = regions(size.width, size.height);
    cx.notify();
  }

  local(e) {
    if (e.bounds) this.origin = { x: e.bounds.x, y: e.bounds.y };
    if (e.local_position) return { x: e.local_position.x, y: e.local_position.y };
    return { x: e.position.x - this.origin.x, y: e.position.y - this.origin.y };
  }

  hitAt(x, y) {
    return hit(this.list, x + this.origin.x, y + this.origin.y);
  }

  down(e, cx) {
    cx.stop_propagation();
    if (this.busy) return;
    const p = this.local(e);
    this.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    cx.notify();
  }

  move(e, cx) {
    this.pointer = this.local(e);
    if (this.drag) {
      if (e.pressed_button !== "left") this.drag = null;
      else Object.assign(this.drag, { x1: this.pointer.x, y1: this.pointer.y });
    }
    cx.notify();
  }

  up(e, cx) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const p = this.local(e);
    d.x1 = p.x;
    d.y1 = p.y;
    const n = this.marks.length + 1;
    const x = Math.round(Math.min(d.x0, d.x1));
    const y = Math.round(Math.min(d.y0, d.y1));
    const w = Math.round(Math.abs(d.x1 - d.x0));
    const h = Math.round(Math.abs(d.y1 - d.y0));
    const box = w >= DRAG || h >= DRAG;
    const mark = box
      ? { n, kind: "box", x, y, w, h }
      : { n, kind: "point", x: Math.round(d.x0), y: Math.round(d.y0) };
    const cx0 = box ? x + w / 2 : mark.x;
    const cy0 = box ? y + h / 2 : mark.y;
    const r = this.hitAt(cx0, cy0);
    mark.at = label(r);
    mark.path = r?.path ?? null;
    if (!box && r) mark.region = { x: r.x, y: r.y, w: r.w, h: r.h };
    this.marks.push(mark);
    cx.notify();
  }

  key(e, cx) {
    if (e.key === "escape") return this.close();
    if (e.key === "backspace" || (e.key === "z" && e.modifiers.control)) this.marks.pop();
    else if (e.key === "c" && e.modifiers.control) this.copy(cx);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // With marks: only the marks count, saved with a screenshot. Without: the block under the pointer, no screenshot.
  copy(cx) {
    if (this.busy) return;
    if (this.marks.length > 0) return this.send(cx);
    const p = this.pointer;
    const r = p && this.hitAt(p.x, p.y);
    if (!r) {
      this.error = "滑鼠先指向一個區塊。";
      return;
    }
    cx.write_to_clipboard(`c-shot 區塊：${label(r)}｜${r.path}｜位置 ${r.x},${r.y}，${r.w}×${r.h}（layout ${shared("layout") ?? "?"}）`);
    this.close();
  }

  send(cx) {
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await new Promise((r) => cx.timer.after(150, () => r(null)));
        const dir = `${appHome()}/c-shot`;
        const base = `${dir}/shot-${stamp(new Date())}`;
        await mkdir(dir, { recursive: true });
        const r = await exec("herdr-app", ["shot", `${base}.png`], { timeout: 20000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `herdr-app shot 結束碼 ${r.code}`);
        const win = window()?.platform === "windows";
        const show = (p) => (win ? p.replace(/\//g, "\\") : p);
        const info = {
          for_claude: FOR_CLAUDE,
          time: new Date().toISOString(),
          image: show(`${base}.png`),
          window: { width: Math.round(this.size.width), height: Math.round(this.size.height) },
          zoom: Number(settings()?.zoom) || 1,
          layout: shared("layout") ?? null,
          marks: this.marks.map((m) => ({ ...m, x: Math.round(m.x + this.origin.x), y: Math.round(m.y + this.origin.y) })),
          focused: focused(),
          panes: tabPanes(),
          regions: this.list,
        };
        await writeFile(`${base}.json`, JSON.stringify(info, null, 2));
        const where = this.marks.map((m) => `#${m.n} ${m.at}`).join("、");
        cx.write_to_clipboard(`看 c-shot 標記 ${show(`${base}.json`)}（${where}）：`);
        this.close();
      } catch (e) {
        this.error = String(e?.message ?? e);
        this.busy = false;
        cx.notify();
      }
    });
  }

  badge(n, x, y) {
    return div().absolute().left(x).top(y).px(5).rounded(4).whitespace_nowrap().bg(`${color(n)}cc`)
      .text_size(11).font_semibold().text_color("#ffffff").child(`#${n}`);
  }

  // Pointer events are in window px; element lengths get scaled by the app zoom.
  z(v) {
    return v / (Number(settings()?.zoom) || 1);
  }

  outline(r, c, id) {
    const z = (v) => this.z(v);
    return div().id(id).absolute().left(z(r.x - this.origin.x)).top(z(r.y - this.origin.y)).w(z(r.w)).h(z(r.h))
      .border(2).border_dashed().border_color(c).bg(`${c}10`);
  }

  // Badges sit outside what they mark so the marked thing stays readable.
  markEls(m) {
    const c = color(m.n);
    const z = (v) => this.z(v);
    if (m.kind === "box") {
      const top = z(m.y) < 22 ? z(m.h) + 2 : -20;
      return [div().absolute().left(z(m.x)).top(z(m.y)).w(z(m.w)).h(z(m.h)).border(2).border_color(c).bg(`${c}22`)
        .child(this.badge(m.n, -2, top))];
    }
    const left = z(m.x) < 40 ? 16 : -30;
    const top = z(m.y) < 24 ? 16 : -20;
    return [
      ...(m.region ? [this.outline(m.region, c, `region-${m.n}`)] : []),
      div().absolute().left(z(m.x) - 7).top(z(m.y) - 7).w(14).h(14).rounded(7).border(2).border_color(c).bg(`${c}33`)
        .child(this.badge(m.n, left, top)),
    ];
  }

  tip(t) {
    const p = this.pointer;
    const r = this.hitAt(p.x, p.y);
    const lines = [`${Math.round(p.x + this.origin.x)}, ${Math.round(p.y + this.origin.y)}`, label(r)];
    if (r) lines.push(`${r.path}　${r.w}×${r.h}`);
    const right = p.x > this.size.width - 300;
    const below = p.y < this.size.height - 90;
    const x = this.z(p.x);
    const y = this.z(p.y);
    return v_flex().absolute().left(right ? x - 290 : x + 16).top(below ? y + 18 : y - 76)
      .max_w(280).px(8).py(5).gap(1).rounded(6).bg(t.popover).border(1).border_color(t.border)
      .text_size(11.5).text_color(t.foreground)
      .children(lines.map((s, i) => div().truncate().text_color(i === 0 ? t.accent : i === 2 ? t.dim : t.foreground).child(s)));
  }

  render(cx) {
    const t = theme();
    const d = this.drag;
    const p = this.pointer;
    const live = !this.busy;
    const z = (v) => this.z(v);
    return div().id("c-shot").track_focus(this.handle).size_full().relative().cursor_crosshair()
      .bg(live ? "#00000014" : "#00000000")
      .on_size_change((size, cx) => this.resized(size, cx))
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", (e, cx) => this.down(e, cx))
      .on_mouse_move((e, cx) => this.move(e, cx))
      .on_mouse_up("left", (e, cx) => this.up(e, cx))
      .when(live && Boolean(p), (el) => el
        .child(div().absolute().left(0).top(z(p.y)).w_full().h(1).bg(`${t.accent}66`))
        .child(div().absolute().left(z(p.x)).top(0).h_full().w(1).bg(`${t.accent}66`)))
      .when(live && Boolean(p) && !d, (el) => {
        const r = this.hitAt(p.x, p.y);
        return r ? el.child(this.outline(r, t.accent, "hover")) : el;
      })
      .children(this.marks.flatMap((m) => this.markEls(m)))
      .when(Boolean(d), (el) => el.child(div().absolute()
        .left(z(Math.min(d.x0, d.x1))).top(z(Math.min(d.y0, d.y1)))
        .w(z(Math.abs(d.x1 - d.x0))).h(z(Math.abs(d.y1 - d.y0)))
        .border(2).border_color(color(this.marks.length + 1))))
      .when(live && Boolean(p), (el) => el.child(this.tip(t)))
      .when(live, (el) => el.child(h_flex().absolute().bottom(16).left(0).w_full().justify_center()
        .child(h_flex().px(12).py(6).gap(14).rounded(8).bg(t.popover).border(1).border_color(t.border)
          .text_size(12).text_color(t.muted)
          .child(div().text_color(t.foreground).font_semibold().child(`標記 ${this.marks.length} 個`))
          .child("點一下：標點")
          .child("拖曳：框選")
          .child("Backspace：復原")
          .child(this.marks.length > 0 ? "Ctrl+C：複製標記並截圖" : "Ctrl+C：複製指向的區塊")
          .child("Esc：取消")
          .when(Boolean(this.error), (el) => el.child(div().text_color(t.ansi1).child(this.error))))));
  }
}
