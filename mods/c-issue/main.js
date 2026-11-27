import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, window, checking, appHome, readTextFile } from "herdr";

const EVERY_MS = 30 * 1000;
const CONFIG = "mods/c-issue/config.json";
const STEP = 5;
const MIN = 5;
const MAX = 50;
const KEY_REPO = "c-issue.repo";
const KEY_COUNT = "c-issue.count";

async function config() {
  const text = await readTextFile(`${appHome()}/${CONFIG}`).catch(() => null);
  if (!text) return { repos: [], font: null };
  let c;
  try {
    c = JSON.parse(text.replace(/^﻿/, "")) ?? {};
  } catch {
    throw new Error(`${CONFIG} 不是正確的 JSON`);
  }
  const list = Array.isArray(c.repos) ? c.repos : [];
  return {
    repos: list.map((r) => String(r ?? "").trim()).filter((r) => /^[^/\s]+\/[^/\s]+$/.test(r)).slice(0, 3),
    font: String(c.font ?? "").trim() || null,
  };
}

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function save(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { }
}

const QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issues(first: $n, states: OPEN, orderBy: { field: CREATED_AT, direction: DESC }) {
      totalCount
      nodes {
        number title url
        blockedBy(first: 10) { nodes { number state repository { nameWithOwner } } }
      }
    }
  }
}`;

function openUrl(url) {
  const p = window()?.platform;
  const [cmd, args] = p === "windows" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : p === "macos" ? ["open", [url]] : ["xdg-open", [url]];
  exec(cmd, args).catch(() => null);
}

export default class GhIssues extends View {
  init(_props, cx) {
    this.repos = [];
    this.repo = load(KEY_REPO);
    const n = Number(load(KEY_COUNT));
    this.count = Number.isInteger(n) && n >= MIN && n <= MAX ? n : 10;
    this.issues = [];
    this.total = 0;
    this.error = null;
    this.loading = false;
    this.again = false;
    this.updated = null;
    if (checking()) return;
    cx.timer.every(EVERY_MS, (cx) => {
      if (window()?.visible === false) return;
      this.refresh(cx);
    });
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    this.again = false;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const c = await config();
        this.repos = c.repos;
        this.font = c.font;
        if (!this.repos.includes(this.repo)) this.repo = this.repos[0] ?? null;
        if (!this.repo) {
          this.issues = [];
          this.total = 0;
          throw new Error(`還沒設定 repo。請執行 install.ps1，或編輯 ${CONFIG}。`);
        }
        const repo = this.repo;
        const [owner, name] = repo.split("/");
        const r = await exec("gh", ["api", "graphql",
          "-f", `query=${QUERY}`,
          "-f", `owner=${owner}`,
          "-f", `name=${name}`,
          "-F", `n=${this.count}`,
        ], { timeout: 60000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `gh 結束碼 ${r.code}`);
        const issues = JSON.parse(r.stdout).data?.repository?.issues;
        if (!issues) throw new Error(`找不到 ${repo}`);
        if (repo === this.repo) {
          this.issues = issues.nodes.filter((n) => n?.url);
          this.total = issues.totalCount;
          this.error = null;
          this.updated = new Date();
        }
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.loading = false;
      cx.notify();
      if (this.again) this.refresh(cx);
    });
  }

  pick(repo, cx) {
    if (repo === this.repo) return;
    this.repo = repo;
    this.issues = [];
    this.total = 0;
    save(KEY_REPO, repo);
    this.refresh(cx);
  }

  resize(delta, cx) {
    const n = Math.min(MAX, Math.max(MIN, this.count + delta));
    if (n === this.count) return;
    this.count = n;
    save(KEY_COUNT, n);
    this.refresh(cx);
  }

  button(id, label, enabled, onClick, t) {
    return div().id(id).px(8).rounded(4).border(1).border_color(t.border).text_size(12)
      .text_color(enabled ? t.foreground : t.dim)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx)))
      .child(label);
  }

  tabs(t) {
    return h_flex().px(8).py(6).gap(4).border_b(1).border_color(t.border)
      .children(this.repos.map((repo) => {
        const on = repo === this.repo;
        return div().id(`tab-${repo}`).flex_1().min_w(0).px(6).py(2).rounded(4).text_size(11.5).truncate()
          .text_color(on ? t.foreground : t.muted)
          .when(on, (el) => el.bg(t.hover).font_semibold())
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.pick(repo, cx))
          .child(repo.split("/")[1]);
      }));
  }

  blockers(issue) {
    return (issue.blockedBy?.nodes ?? [])
      .filter((b) => b?.state === "OPEN")
      .map((b) => b.repository?.nameWithOwner === this.repo ? `#${b.number}` : `${b.repository?.nameWithOwner}#${b.number}`);
  }

  row(issue, t) {
    const blockers = this.blockers(issue);
    return v_flex().id(`issue-${issue.url}`).px(12).py(5).gap(2).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => openUrl(issue.url))
      .child(h_flex().gap(6)
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`#${issue.number}`))
        .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).truncate().child(issue.title)))
      .when(blockers.length > 0, (el) => el.child(
        div().text_size(11).text_color(t.ansi1).truncate().child(`被 ${blockers.join("、")} 擋住`)));
  }

  render(cx) {
    const t = theme();
    const time = this.updated ? this.updated.toTimeString().slice(0, 5) : "—";
    const empty = !this.loading && !this.error && this.issues.length === 0;
    return v_flex().id("root").size_full().bg(t.chrome).text_color(t.foreground)
      .when(this.font, (el) => el.font_family(this.font))
      .child(h_flex().px(12).h(32).items_center().gap(8).border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(12.5).child("GitHub Issue"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(this.loading ? "更新中…" : `更新於 ${time}`))
        .child(div().id("refresh").px(6).rounded(4).text_size(11).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx)).child("重新整理")))
      .when(this.repos.length > 0, (el) => el.child(this.tabs(t)))
      .when(Boolean(this.error), (el) => el.child(
        div().px(12).py(6).text_size(11).text_color(t.ansi1).child(this.error)))
      .child(v_flex().id("list").flex_1().overflow_y_scrollbar().py(4)
        .when(empty, (el) => el.child(div().px(12).py(4).text_size(11.5).text_color(t.dim).child("沒有 open 的 issue")))
        .children(this.issues.map((issue) => this.row(issue, t))))
      .child(h_flex().px(12).h(32).items_center().gap(6).border_t(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.muted).child(`顯示 ${this.issues.length}／${this.total} 筆（上限 ${this.count}）`))
        .child(div().flex_1())
        .child(this.button("less", "−", this.count > MIN, (cx) => this.resize(-STEP, cx), t))
        .child(this.button("more", "+", this.count < MAX, (cx) => this.resize(STEP, cx), t)));
  }
}
