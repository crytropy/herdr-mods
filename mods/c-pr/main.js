import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import {
  exec, theme, window, checking, appHome, readTextFile,
  props, openOverlay, closeOverlay, shared, setShared,
} from "herdr";

const EVERY_MS = 30 * 1000;
const CONFIG = "mods/c-pr/config.json";
// 跳框合併成功後寫進 shared，面板看到就把那個 PR 拿掉並重新整理。
const KEY_MERGED = "c-pr.merged";
// GitHub 的搜尋要過一下才會反映剛合併的 PR。
const AFTER_MERGE_MS = 3000;

async function config() {
  const text = await readTextFile(`${appHome()}/${CONFIG}`).catch(() => null);
  if (!text) return { scope: "", font: null };
  try {
    const c = JSON.parse(text.replace(/^﻿/, "")) ?? {};
    return { scope: String(c.scope ?? "").trim(), font: String(c.font ?? "").trim() || null };
  } catch {
    throw new Error(`${CONFIG} 不是正確的 JSON`);
  }
}

const FRAGMENT = `fragment P on PullRequest {
  number title url isDraft reviewDecision mergeable mergeStateStatus
  mergeQueueEntry { position state }
  autoMergeRequest { enabledAt }
  repository { name }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

const QUERY = `query($mine: String!, $review: String!) {
  mine: search(query: $mine, type: ISSUE, first: 50) { nodes { ...P } }
  review: search(query: $review, type: ISSUE, first: 50) { nodes { ...P } }
}
${FRAGMENT}`;

// 跳框裡看一個 PR 用的：說明、留言，和合併要用的狀態。
const DETAIL = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    viewerDefaultMergeMethod
    pullRequest(number: $number) {
      ...P
      body state createdAt additions deletions changedFiles headRefName baseRefName
      author { login }
      labels(first: 10) { nodes { name } }
      assignees(first: 5) { nodes { login } }
      comments(first: 30) { totalCount nodes { body createdAt author { login } } }
    }
  }
}
${FRAGMENT}`;

function ci(pr, t) {
  const s = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
  if (s === "SUCCESS") return ["CI 通過", t.ansi2];
  if (s === "FAILURE" || s === "ERROR") return ["CI 失敗", t.ansi1];
  if (s === "PENDING" || s === "EXPECTED") return ["CI 執行中", t.ansi3];
  return ["無 CI", t.dim];
}

function review(pr, t) {
  switch (pr.reviewDecision) {
    case "APPROVED": return ["已核准", t.ansi2];
    case "CHANGES_REQUESTED": return ["要求修改", t.ansi1];
    case "REVIEW_REQUIRED": return ["待 review", t.ansi3];
    default: return ["免 review", t.dim];
  }
}

function queue(entry, t) {
  const n = `佇列第 ${entry.position + 1} 位`;
  switch (entry.state) {
    case "AWAITING_CHECKS": return [`${n}・跑 CI`, t.ansi3];
    case "MERGEABLE": return [`${n}・可合併`, t.ansi2];
    case "UNMERGEABLE": return [`${n}・失敗`, t.ansi1];
    case "LOCKED": return [`${n}・鎖住`, t.ansi1];
    default: return [n, t.ansi4];
  }
}

function merge(pr, t) {
  if (pr.mergeQueueEntry) return queue(pr.mergeQueueEntry, t);
  if (pr.isDraft) return ["草稿", t.dim];
  if (pr.autoMergeRequest && pr.mergeable !== "CONFLICTING") return ["auto-merge 等進佇列", t.ansi4];
  if (pr.mergeable === "CONFLICTING") return ["有衝突", t.ansi1];
  if (pr.mergeable === "UNKNOWN") return ["計算中", t.dim];
  switch (pr.mergeStateStatus) {
    case "CLEAN":
    case "HAS_HOOKS": return ["可合併", t.ansi2];
    case "UNSTABLE": return ["可合併（檢查未過）", t.ansi3];
    case "BEHIND": return ["落後 base", t.ansi3];
    case "BLOCKED": return ["不能合併", t.ansi1];
    case "DIRTY": return ["有衝突", t.ansi1];
    default: return ["計算中", t.dim];
  }
}

// 合併鈕只在 GitHub 說乾淨可合併時才能按：草稿、有衝突、檢查沒過、已經在佇列裡的都不行。
function ready(pr) {
  return pr.state === "OPEN" && !pr.isDraft && !pr.mergeQueueEntry && pr.mergeable === "MERGEABLE"
    && (pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "HAS_HOOKS");
}

// gh 在沒有終端機時一定要指定合併方式，所以用這個 repo 自己的預設。
function method(name) {
  return name === "MERGE" ? "--merge" : name === "REBASE" ? "--rebase" : "--squash";
}

function day(iso) {
  return String(iso ?? "").slice(0, 10);
}

// 說明和留言接成一份 Markdown，留言之間用橫線隔開。
function page(pr) {
  const parts = [pr.body?.trim() || "（沒有說明）"];
  const comments = pr.comments?.nodes ?? [];
  for (const c of comments) {
    parts.push(`---\n\n**${c?.author?.login ?? "ghost"}** · ${day(c?.createdAt)}\n\n${c?.body ?? ""}`);
  }
  const more = (pr.comments?.totalCount ?? 0) - comments.length;
  if (more > 0) parts.push(`---\n\n還有 ${more} 則留言，請到瀏覽器看。`);
  return parts.join("\n\n");
}

function openUrl(url) {
  const p = window()?.platform;
  const [cmd, args] = p === "windows" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : p === "macos" ? ["open", [url]] : ["xdg-open", [url]];
  exec(cmd, args).catch(() => null);
}

export default class GhPrs extends View {
  init(_props, cx) {
    // 同一個 mod 有兩種樣子：平常是面板；被自己用跳框打開時（props 帶著一個 PR），只顯示那個 PR。
    this.view = props()?.pr ?? null;
    this.error = null;
    this.font = null;
    if (this.view) {
      this.detail = null;
      this.how = null;
      this.asking = false;
      this.merging = false;
      if (!checking()) this.read(cx);
      return;
    }
    this.mine = [];
    this.review = [];
    this.gone = new Set();
    this.merged = shared(KEY_MERGED)?.at ?? null;
    this.loading = false;
    this.updated = null;
    if (checking()) return;
    cx.timer.every(EVERY_MS, (cx) => {
      if (window()?.visible === false) return;
      this.refresh(cx);
    });
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const c = await config();
        this.font = c.font;
        const base = `is:pr is:open archived:false ${c.scope}`.trim();
        const r = await exec("gh", ["api", "graphql",
          "-f", `query=${QUERY}`,
          "-f", `mine=${base} author:@me`,
          "-f", `review=${base} review-requested:@me`,
        ], { timeout: 60000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `gh 結束碼 ${r.code}`);
        const data = JSON.parse(r.stdout).data;
        this.mine = data.mine.nodes.filter((n) => n?.url);
        this.review = data.review.nodes.filter((n) => n?.url);
        this.error = null;
        this.updated = new Date();
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.loading = false;
      cx.notify();
    });
  }

  show(pr) {
    openOverlay({
      mod: "c-pr",
      kind: "dialog",
      width: 760,
      height: 0.8,
      props: { pr: { url: pr.url, number: pr.number, title: pr.title, repo: pr.repository?.name } },
    });
  }

  read(cx) {
    cx.spawn(async (cx) => {
      try {
        this.font = (await config().catch(() => null))?.font ?? null;
        const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(this.view.url);
        if (!m) throw new Error(`看不懂這個網址：${this.view.url}`);
        const r = await exec("gh", ["api", "graphql",
          "-f", `query=${DETAIL}`,
          "-f", `owner=${m[1]}`,
          "-f", `name=${m[2]}`,
          "-F", `number=${m[3]}`,
        ], { timeout: 60000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `gh 結束碼 ${r.code}`);
        const repo = JSON.parse(r.stdout).data?.repository;
        if (!repo?.pullRequest) throw new Error("找不到這個 PR");
        this.detail = repo.pullRequest;
        this.how = repo.viewerDefaultMergeMethod;
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  // 第一次按只是問；第二次按才真的合併。不刪分支：repo 有設自動刪的話 GitHub 自己會刪。
  mergeNow(cx) {
    if (this.merging || !this.detail || !ready(this.detail)) return;
    if (!this.asking) {
      this.asking = true;
      cx.notify();
      return;
    }
    this.asking = false;
    this.merging = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["pr", "merge", this.view.url, method(this.how)], { timeout: 120000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `gh 結束碼 ${r.code}`);
        setShared(KEY_MERGED, { url: this.view.url, at: Date.now() });
        closeOverlay(props()?.overlay);
        return;
      } catch (e) {
        this.error = `合併失敗：${String(e?.message ?? e)}`;
      }
      this.merging = false;
      cx.notify();
    });
  }

  // 面板：別的視圖（跳框）剛合併了一個 PR，先把它從清單拿掉，等一下再跟 GitHub 對一次。
  noticeMerge(cx) {
    const m = shared(KEY_MERGED);
    if (!m?.at || m.at === this.merged) return;
    this.merged = m.at;
    this.gone.add(m.url);
    cx.timer.after(AFTER_MERGE_MS, (cx) => this.refresh(cx));
  }

  tag([text, color], t) {
    return div().px(5).rounded(3).border(1).border_color(color).text_color(color).text_size(10.5).child(text);
  }

  button(id, label, enabled, onClick, t, color) {
    return div().id(id).px(8).py(2).rounded(4).border(1).border_color(color ?? t.border).text_size(12)
      .text_color(enabled ? (color ?? t.foreground) : t.dim)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx)))
      .child(label);
  }

  row(pr, key, t) {
    return v_flex().id(`${key}-${pr.url}`).px(12).py(6).gap(3).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.show(pr))
      .child(div().text_color(t.foreground).text_size(12.5).truncate().child(pr.title))
      .child(h_flex().gap(5).items_center().flex_wrap()
        .child(div().text_color(t.muted).text_size(11).child(`${pr.repository.name}#${pr.number}`))
        .child(this.tag(ci(pr, t), t))
        .child(this.tag(review(pr, t), t))
        .child(this.tag(merge(pr, t), t)));
  }

  section(title, all, key, t) {
    const list = all.filter((pr) => !this.gone.has(pr.url));
    return v_flex()
      .child(h_flex().px(12).pt(10).pb(4).gap(6).text_size(11).font_semibold().text_color(t.muted)
        .child(title).child(div().text_color(t.dim).child(String(list.length))))
      .when(list.length === 0, (el) => el.child(div().px(12).py(4).text_size(11.5).text_color(t.dim).child("沒有")))
      .children(list.map((pr) => this.row(pr, key, t)));
  }

  card(t) {
    const v = this.view;
    const d = this.detail;
    const close = () => closeOverlay(props()?.overlay);
    const names = (list) => (list?.nodes ?? []).map((n) => n?.name ?? n?.login).filter(Boolean).join("、");
    const meta = d ? [
      d.state === "MERGED" ? "已合併" : d.state === "CLOSED" ? "已關" : "開著",
      `${d.author?.login ?? "ghost"} 開於 ${day(d.createdAt)}`,
      `${d.headRefName} → ${d.baseRefName}`,
      `${d.changedFiles} 個檔案 +${d.additions} −${d.deletions}`,
      names(d.labels) && `標籤：${names(d.labels)}`,
      names(d.assignees) && `指派：${names(d.assignees)}`,
    ].filter(Boolean).join("　·　") : this.error ? "" : "讀取中…";
    const can = Boolean(d) && ready(d) && !this.merging;
    const label = this.merging ? "合併中…" : this.asking ? `確定合併 #${v.number}？再按一次` : "合併";
    return v_flex().id("card").size_full().min_h(0).p(16).gap(10).bg(t.popover).text_color(t.foreground).text_size(13)
      .when(this.font, (el) => el.font_family(this.font))
      .child(h_flex().items_start().gap(8)
        .child(div().flex_none().text_size(15).text_color(t.dim).child(`${v.repo ?? ""}#${v.number}`))
        .child(div().flex_1().min_w(0).text_size(15).font_semibold().child(d?.title ?? v.title ?? "")))
      .child(div().text_size(11.5).text_color(t.muted).child(meta))
      .when(Boolean(d), (el) => el.child(h_flex().gap(5).items_center().flex_wrap()
        .child(this.tag(ci(d, t), t))
        .child(this.tag(review(d, t), t))
        .child(this.tag(merge(d, t), t))))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.ansi1).child(this.error)))
      .child(div().id("card-body").flex_1().min_h(0).overflow_y_scrollbar().border_t(1).border_color(t.border).pt(8)
        .when(Boolean(d), (el) => el.child(TextView.markdown("card-text", page(d)).selectable(true))))
      .child(h_flex().items_center().gap(8)
        .child(this.button("merge", label, can, (cx) => this.mergeNow(cx), t, this.asking ? t.ansi1 : can ? t.ansi2 : null))
        .child(div().flex_1())
        .child(this.button("browser", "在瀏覽器開啟", true, () => { openUrl(v.url); close(); }, t))
        .child(this.button("close", "關閉", true, close, t)));
  }

  render(cx) {
    const t = theme();
    if (this.view) return this.card(t);
    this.noticeMerge(cx);
    const time = this.updated ? this.updated.toTimeString().slice(0, 5) : "—";
    return v_flex().id("root").size_full().bg(t.chrome).text_color(t.foreground)
      .when(this.font, (el) => el.font_family(this.font))
      .child(h_flex().px(12).h(32).items_center().gap(8).border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(12.5).child("GitHub PR"))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child(this.loading ? "更新中…" : `更新於 ${time}`))
        .child(div().id("refresh").px(6).rounded(4).text_size(11).text_color(t.muted)
          .hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => this.refresh(cx)).child("重新整理")))
      .when(Boolean(this.error), (el) => el.child(
        div().px(12).py(6).text_size(11).text_color(t.ansi1).child(this.error)))
      .child(v_flex().id("list").flex_1().overflow_y_scrollbar().pb(8)
        .child(this.section("我開的", this.mine, "mine", t))
        .child(this.section("等我 review", this.review, "review", t)));
  }
}
