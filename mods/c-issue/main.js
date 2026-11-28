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
const KEY_FOLDED = "c-issue.folded";
const INDENT = 14;

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
        subIssuesSummary { total completed }
        parent {
          number title url state
          repository { nameWithOwner }
          subIssuesSummary { total completed }
        }
      }
    }
  }
}`;

// 把子票掛到母票下面。母票不在清單裡（已關、在別的 repo、或超過筆數）時，
// 用子票帶回來的母票資料補一列。
// 一整組排在組裡最新那張票的位置，所以新開的子票會把整組帶到上面。
function tree(issues) {
  const nodes = new Map(issues.map((issue) => [issue.url, { issue, kids: [], above: null, outside: false }]));
  for (const issue of issues) {
    const parent = issue.parent;
    if (!parent?.url) continue;
    let above = nodes.get(parent.url);
    if (!above) {
      above = { issue: parent, kids: [], above: null, outside: true };
      nodes.set(parent.url, above);
    }
    const node = nodes.get(issue.url);
    node.above = above;
    above.kids.push(node);
  }
  // 子票照開票順序排：先開的在上面。同一個 repo 裡，編號小的就是先開的。
  for (const node of nodes.values()) node.kids.sort((a, b) => a.issue.number - b.issue.number);
  const top = new Set();
  for (const issue of issues) {
    let node = nodes.get(issue.url);
    while (node.above) node = node.above;
    top.add(node);
  }
  return [...top];
}

function loadFolded() {
  try {
    const list = JSON.parse(load(KEY_FOLDED) ?? "[]");
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

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
    this.folded = loadFolded();
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

  fold(url, cx) {
    if (!this.folded.delete(url)) this.folded.add(url);
    save(KEY_FOLDED, JSON.stringify([...this.folded]));
    cx.notify();
  }

  // 一個節點和它下面沒收起來的子票，攤平成一列一列。
  rows(node, depth, t) {
    const open = !this.folded.has(node.issue.url);
    return [
      this.row(node, depth, open, t),
      ...(open ? node.kids.flatMap((kid) => this.rows(kid, depth + 1, t)) : []),
    ];
  }

  row(node, depth, open, t) {
    const issue = node.issue;
    const blockers = this.blockers(issue);
    const hasKids = node.kids.length > 0;
    const sum = issue.subIssuesSummary;
    const there = issue.repository?.nameWithOwner;
    const number = node.outside && there && there !== this.repo ? `${there}#${issue.number}` : `#${issue.number}`;
    const closed = node.outside && issue.state === "CLOSED";
    return h_flex().id(`row-${issue.url}`).items_start().pl(2 + depth * INDENT)
      .hover((s) => s.bg(t.hover))
      .child(div().id(`fold-${issue.url}`).flex_none().w(14).py(5).text_size(11).text_color(t.muted)
        .when(hasKids, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.fold(issue.url, cx)))
        .child(hasKids ? (open ? "▾" : "▸") : ""))
      .child(v_flex().id(`issue-${issue.url}`).flex_1().min_w(0).pr(12).py(5).gap(2).cursor_pointer()
        .on_click(() => openUrl(issue.url))
        .child(h_flex().gap(6)
          .child(div().flex_none().text_size(11.5).text_color(t.dim).child(number))
          .child(div().flex_1().min_w(0).text_size(12.5).truncate()
            .text_color(node.outside ? t.muted : t.foreground)
            .child(closed ? `${issue.title}（已關）` : issue.title))
          .when(sum?.total > 0, (el) => el.child(
            div().flex_none().text_size(11).text_color(t.dim).child(`${sum.completed}/${sum.total}`))))
        .when(blockers.length > 0, (el) => el.child(
          div().text_size(11).text_color(t.ansi1).truncate().child(`被 ${blockers.join("、")} 擋住`))));
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
        .children(tree(this.issues).flatMap((node) => this.rows(node, 0, t))))
      .child(h_flex().px(12).h(32).items_center().gap(6).border_t(1).border_color(t.border)
        .child(div().text_size(11).text_color(t.muted).child(`顯示 ${this.issues.length}／${this.total} 筆（上限 ${this.count}）`))
        .child(div().flex_1())
        .child(this.button("less", "−", this.count > MIN, (cx) => this.resize(-STEP, cx), t))
        .child(this.button("more", "+", this.count < MAX, (cx) => this.resize(STEP, cx), t)));
  }
}
