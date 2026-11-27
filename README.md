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

## c-shot：標記位置

終端機沒辦法貼圖。c-shot 讓你在 herdr 畫面上指出位置，再把位置交給 Claude。

按 `Ctrl+Alt+P`，畫面上會蓋一層透明圖層：

- **滑鼠指向**：游標旁顯示座標，以及那裡是哪個區塊或 mod。那個區塊會用虛線框起來。
- **點一下**：標一個點，同時自動用虛線框住它所在的整個區塊。
- **拖曳**：框一個範圍。可以標好幾個，每個有編號（`#1`、`#2`…）。
- `Backspace`：復原上一個。`Esc`：取消。

按 `Ctrl+C` 複製，然後標記畫面會關掉。複製什麼要看你有沒有標記：

- **沒有標記**：只複製滑鼠指向的區塊名稱和位置，不截圖。例如 `c-shot 區塊：agents mod（agents）｜root › sidebar › sidebar-lists › agents｜位置 0,511，259×461（layout main-pr）`。
- **有標記**：只複製你標的點和框，不管滑鼠當下指向哪裡。c-shot 會：
  1. 截下整個 herdr 視窗，上面畫著你的標記。
  2. 在 `~/.config/herdr-app/c-shot/` 存一張 `shot-<時間>.png` 和一份同名的 `.json`。`.json` 有每個標記的座標、落在哪個 mod、layout 區塊和 pane 清單。
  3. 把一行文字放進剪貼簿，例如 `看 c-shot 標記 C:\...\shot-20261127-153012.json（#1 c-pr mod（gh-prs））：`。

把複製的內容貼給 Claude，後面接你要改什麼。有截圖時，Claude 會讀 `.json` 和截圖。

截圖不會自動刪除。不要的話，直接刪掉 `c-shot` 資料夾裡的檔案。

### 安裝（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File mods\c-shot\install.ps1
```

安裝程式會把 `Ctrl+Alt+P` 加進 `keys.json`。這個鍵已經有別的用途的話，它不會改，只會提醒你。

### 手動安裝（macOS、Linux 或不想跑腳本）

1. 把 `mods/c-shot/` 裡的 `main.js`、`mod.json`、`jsconfig.json` 複製到 `~/.config/herdr-app/mods/c-shot/`。
2. 在 `~/.config/herdr-app/keys.json` 的 `global` 加上 `"ctrl-alt-p": "mod.open:c-shot"`。

不設快捷鍵也可以，從指令面板找「標記位置（c-shot）」。
