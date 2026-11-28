// 在終端機裡 Ctrl+點一個 GitHub PR 網址：不開瀏覽器，改開 c-pr 的跳框。
// 哪些網址會送到這裡，由 mod.json 的 link_handlers 決定。
import { openOverlay } from "herdr";

export function handleLink(click) {
  const m = click.link.kind === "url" ? /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(click.link.url) : null;
  if (!m) return "pass";
  openOverlay({
    mod: "c-pr",
    kind: "dialog",
    width: 760,
    height: 0.8,
    // 標題等跳框自己去 GitHub 拿。網址只留到編號，後面的 #issuecomment 之類不要。
    props: { pr: { url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`, number: Number(m[3]), title: "", repo: m[2] } },
  });
  return "handled";
}
