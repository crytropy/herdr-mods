import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, window, checking, appHome, readTextFile } from "herdr";

const EVERY_MS = 30 * 1000;
const CONFIG = "mods/c-pr/config.json";

async function scope() {
  const text = await readTextFile(`${appHome()}/${CONFIG}`).catch(() => null);
  if (!text) return "";
  try {
    return String(JSON.parse(text.replace(/^﻿/, "")).scope ?? "").trim();
  } catch {
    throw new Error(`${CONFIG} 不是正確的 JSON`);
  }
}

const QUERY = `query($mine: String!, $review: String!) {
  mine: search(query: $mine, type: ISSUE, first: 50) { nodes { ...P } }
  review: search(query: $review, type: ISSUE, first: 50) { nodes { ...P } }
}
fragment P on PullRequest {
  number title url isDraft reviewDecision mergeable mergeStateStatus
  mergeQueueEntry { position state }
  autoMergeRequest { enabledAt }
  repository { name }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

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

function openUrl(url) {
  const p = window()?.platform;
  const [cmd, args] = p === "windows" ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : p === "macos" ? ["open", [url]] : ["xdg-open", [url]];
  exec(cmd, args).catch(() => null);
}

export default class GhPrs extends View {
  init(_props, cx) {
    this.mine = [];
    this.review = [];
    this.error = null;
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
        const base = `is:pr is:open archived:false ${await scope()}`.trim();
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

  tag([text, color], t) {
    return div().px(5).rounded(3).border(1).border_color(color).text_color(color).text_size(10.5).child(text);
  }

  row(pr, key, t) {
    return v_flex().id(`${key}-${pr.url}`).px(12).py(6).gap(3).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => openUrl(pr.url))
      .child(div().text_color(t.foreground).text_size(12.5).truncate().child(pr.title))
      .child(h_flex().gap(5).items_center().flex_wrap()
        .child(div().text_color(t.muted).text_size(11).child(`${pr.repository.name}#${pr.number}`))
        .child(this.tag(ci(pr, t), t))
        .child(this.tag(review(pr, t), t))
        .child(this.tag(merge(pr, t), t)));
  }

  section(title, list, key, t) {
    return v_flex()
      .child(h_flex().px(12).pt(10).pb(4).gap(6).text_size(11).font_semibold().text_color(t.muted)
        .child(title).child(div().text_color(t.dim).child(String(list.length))))
      .when(list.length === 0, (el) => el.child(div().px(12).py(4).text_size(11.5).text_color(t.dim).child("沒有")))
      .children(list.map((pr) => this.row(pr, key, t)));
  }

  render(cx) {
    const t = theme();
    const time = this.updated ? this.updated.toTimeString().slice(0, 5) : "—";
    return v_flex().id("root").size_full().bg(t.chrome).text_color(t.foreground)
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
