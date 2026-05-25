# HKU Exambase Past Paper 下载脚本

这个脚本会登录 HKU Exambase，按课程号前缀查找课程，并把可下载的 PDF past papers 保存到本地。

## 准备

先确认依赖已经安装：

```bash
npm install
npx playwright install chromium
```

推荐用环境变量提供账号密码，避免把密码写进命令历史或文件：

```bash
export HKU_USERNAME="你的HKU账号"
export HKU_PASSWORD="你的HKU密码"
```

## 常用命令

只查看会匹配到哪些课程，不下载：

```bash
npm run download -- --prefix COMP327 --dry-run
```

下载指定课程号前缀的 past papers：

```bash
npm run download -- --prefix COMP327
```

只试下载第一个匹配课程：

```bash
npm run download -- --prefix COMP327 --limit 1
```

如果登录状态过期，强制重新登录：

```bash
npm run download -- --prefix COMP327 --no-session
```

如果需要观察浏览器或处理 2FA：

```bash
npm run download -- --prefix COMP327 --headful --no-session
```

## Prefix 规则

`--prefix` 支持大小写混用，脚本会自动转成大写。

示例：

```bash
npm run download -- --prefix COMP
npm run download -- --prefix COMP3
npm run download -- --prefix comp327
```

`--prefix comp327` 会匹配这类课程：

```text
COMP3270
COMP3270B
COMP3271
COMP3278
COMP3278A
COMP3278B
```

## 输出目录和文件名

默认输出目录是 `downloads/`，每个课程一个子文件夹：

```text
downloads/
├── COMP3270/
│   ├── 2025_12_20_COMP3270.pdf
│   ├── 2023_12_09_COMP3270.pdf
│   └── 2021_12_22_COMP3270.pdf
└── COMP3271/
    └── ...
```

文件名格式固定为：

```text
yyyy_mm_dd_{coursecode}.pdf
```

## 跳过已下载课程

如果 `downloads/{课程号}/` 已存在，并且不是空文件夹，脚本会跳过这门课。

示例输出：

```text
[COMP3270] 已存在非空目录，跳过: downloads/COMP3270
```

如果想重新下载某门课，先删除对应课程文件夹：

```bash
rm -r downloads/COMP3270
```

## 参数说明

| 参数 | 作用 | 示例 |
| --- | --- | --- |
| `--prefix` | 指定课程号前缀 | `--prefix COMP327` |
| `--limit` | 限制处理的课程数量 | `--limit 1` |
| `--dry-run` | 只列出课程，不下载 PDF | `--dry-run` |
| `--out` | 指定输出目录 | `--out ./pastpapers` |
| `--headful` | 显示浏览器窗口 | `--headful` |
| `--no-session` | 不复用保存的登录状态 | `--no-session` |
| `--no-save-session` | 登录后不保存 session | `--no-save-session` |

也可以直接传账号密码：

```bash
node scripts/download-exambase-pastpapers.mjs \
  --username "你的HKU账号" \
  --password "你的HKU密码" \
  --prefix COMP327
```

## Debug

登录或 2FA 出问题：

```bash
npm run download:debug
```

课程发现出问题：

```bash
npm run download:debug:courses -- COMP327
```

调试脚本会生成 `debug-*.png` 截图。截图、`downloads/`、`.exambase-session.json` 已经被 `.gitignore` 忽略。

## 提取单题

下载 PDF 后，可以把一份 past paper 提取成单题 JSON：

```bash
npm run extract:questions -- --pdf downloads/COMP3251/2025_05_17_COMP3251.pdf
```

默认输出：

```text
extracted/COMP3251/2025_05_COMP3251.questions.json
```

输出 JSON 会包含：

```json
{
  "status": "ok",
  "source": {
    "pdfPath": "downloads/COMP3251/2025_05_17_COMP3251.pdf",
    "courseCode": "COMP3251",
    "courseName": "Algorithm Design",
    "examYearMonth": "2025-05"
  },
  "questions": [
    {
      "id": "COMP3251_2025_05_Q1_01",
      "type": "coding",
      "questionNo": "1",
      "prompt": "..."
    }
  ]
}
```

指定输出路径：

```bash
npm run extract:questions -- \
  --pdf downloads/COMP3251/2025_05_17_COMP3251.pdf \
  --out extracted/custom.json
```

如果 PDF 没有可靠文本层，脚本会输出：

```json
{
  "status": "needs_ocr",
  "reason": "No reliable text layer detected",
  "questions": []
}
```

当前版本优先使用 PDF 自带文本层，不调用外部 AI API。

## 在网页里使用导入题库生成 Mock

1. 先提取题目：

```bash
npm run extract:questions -- --pdf downloads/COMP3251/2025_05_17_COMP3251.pdf
```

2. 打开网页的 `Bank` 页面，上传生成的 JSON：

```text
extracted/COMP3251/2025_05_COMP3251.questions.json
```

3. 到 `Generate` 页面输入课程号：

```text
COMP3251
```

如果输入比较模糊，例如 `COMP3`，并且本地题库里匹配到多个课程，页面会显示候选课程并要求你先选择一个；不选择时不会生成 mock。

匹配到真题时，mock 会优先使用导入的真题；没有匹配题库时，会回退到原来的模板题。
