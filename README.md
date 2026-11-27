# herdr-mods

[herdr](https://herdr.dev) 的 mod。每個 mod 放在 `mods/<名稱>/`。

## c-pr：GitHub PR 面板

右側面板，列出兩份清單，每 30 秒更新：

- **我開的**：自己開、還沒關的 PR。
- **等我 review**：別人請你 review 的 PR。

每個 PR 顯示 CI、review、能不能合併。點一下用瀏覽器開啟。

### 需要

- [GitHub CLI](https://cli.github.com/)（`gh`），並且已經 `gh auth login`。

### 安裝（Windows）

```powershell
git clone https://github.com/crytropy/herdr-mods
cd herdr-mods
powershell -ExecutionPolicy Bypass -File mods\c-pr\install.ps1
```

安裝程式會問面板要顯示哪些 PR：

1. **所有 repo 的 PR**（預設）
2. **指定組織的 PR**：輸入組織名稱，多個用空白隔開。
3. **自行指定**：輸入 GitHub 搜尋條件，例如 `user:octocat repo:owner/name`。

裝好後，herdr 會自動把面板放到右側。也可以從指令面板（command palette）找「GitHub PR 面板」打開。

要改顯示範圍，再跑一次 `install.ps1` 就好。

### 手動安裝（macOS、Linux 或不想跑腳本）

1. 把 `mods/c-pr/` 裡的 `main.js`、`mod.json`、`jsconfig.json` 複製到 `~/.config/herdr-app/mods/c-pr/`。
2. 要限制範圍的話，在同一個資料夾建 `config.json`：

   ```json
   { "scope": "org:my-org" }
   ```

   `scope` 是 GitHub 搜尋條件。沒有這個檔、或 `scope` 是空的，就顯示所有 repo 的 PR。

改 `config.json` 不用重開 herdr，下一次更新就會套用。

## c-issue：GitHub Issue 面板

右側面板，顯示指定 repo 的 open issue，每 30 秒更新：

- 最多三個 repo，用面板頂部的分頁切換。
- 最新建立的 issue 排在最上面。
- 每列只顯示編號和標題。點一下用瀏覽器開啟。
- issue 在 GitHub 上設了「Blocked by」，而且擋住它的 issue 還沒關，標題下面會用紅字顯示「被 #38、#41 擋住」。
- 預設顯示 10 筆。按底部的 `−`／`+` 一次加減 5 筆，範圍 5～50。

herdr 重開後，面板會記得上次選的 repo 和筆數。

### 需要

- [GitHub CLI](https://cli.github.com/)（`gh`），並且已經 `gh auth login`。

### 安裝（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File mods\c-issue\install.ps1
```

安裝程式會問三個 repo，格式是 `owner/name`，例如 `cli/cli`。不滿三個就直接按 Enter 略過。

要換 repo，再跑一次 `install.ps1` 就好。

### 手動安裝（macOS、Linux 或不想跑腳本）

1. 把 `mods/c-issue/` 裡的 `main.js`、`mod.json`、`jsconfig.json` 複製到 `~/.config/herdr-app/mods/c-issue/`。
2. 在同一個資料夾建 `config.json`：

   ```json
   { "repos": ["owner/repo-a", "owner/repo-b", "owner/repo-c"] }
   ```

改 `config.json` 不用重開 herdr，下一次更新就會套用。
