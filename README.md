# H12-821 数通刷题

用于集中复习 H12-821 的中文刷题网页，包含 **485 道题、21 章知识精讲**。支持电脑和手机浏览器。

## 功能

- 按章节、题型、题量练习，随机抽题与原题号搜索。
- 单选、多选、判断和填空判分；查看原答案、解析及对应章节精讲。
- 错题订正、收藏、答题卡、刷新续做和练习统计。
- 学习进度保存在当前浏览器，可导出、导入 JSON 备份。
- 21 章精讲按知识点组织，附速记要点与 3–7 天学习安排。

题库覆盖原题号 003–487，移除了两条广告记录，仅包含 821。461 道题可自动判分，另 24 道题需要人工核对，其中 Q52、Q188、Q237、Q399 的原答案存在争议。原题答案和解析保留来源口径，核对提示可在网页中查看。

## 直接运行

仓库已包含构建完成的 `dist/`，只需 **Node.js 18 或更高版本**，无需安装依赖：

```bash
git clone https://github.com/sssssjw11/h12-821-practice.git
cd h12-821-practice
node server.mjs
```

打开 `http://127.0.0.1:8210/`。Windows 也可双击 [启动刷题.cmd](启动刷题.cmd)。

## 上传服务器

下载 [h12-821-practice-server.zip](h12-821-practice-server.zip) 并解压，在解压后的目录执行：

```bash
node server.mjs --host 0.0.0.0 --port 8210
```

打开 `http://服务器IP:8210/`，并在服务器防火墙或云安全组放行对应端口。也可直接克隆仓库，运行同一命令。详细说明见 [服务器部署说明](服务器部署说明.md)。

`dist/` 也可交给 Nginx 等静态服务器托管；部署在域名根路径，单页应用请求回退到 `index.html`。

## 修改源码

开发构建建议使用 Node.js 22 或更高版本及 pnpm：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

开发页面地址为 `http://127.0.0.1:8211/`。也支持 `npm install` 后使用对应的 `npm run` 命令。

```bash
pnpm typecheck
pnpm test
pnpm build
```

修改题库请编辑 `public/bank.json`，再重新构建以更新 `dist/`。`scripts/build_bank.py` 是原始学习资料的转换工具，需另外提供已整理的学习资料目录，并用 `--source` 指定；日常运行和构建不需要这些原始资料。

## 项目文件

| 文件 | 用途 |
| --- | --- |
| `src/` | React、TypeScript 网页源码 |
| `public/bank.json` | 485 道题及 21 章精讲 |
| `tests/` | 判分、题库完整性、进度保存和导入验证 |
| `dist/` | 可直接运行的生产页面 |
| `server.mjs` | 零依赖 Node.js 静态服务器 |
| `h12-821-practice-server.zip` | 上传服务器的完整部署包 |
| [使用说明](使用说明.md) | 本地启动与进度备份 |

源码采用 React 19、Vite 6、TypeScript。交付时 18 项单元测试及生产构建通过。

作答记录只保存在浏览器的 localStorage，换浏览器、换站点地址或清理网站数据前请导出备份。题目图片引用原始远程地址，需要访问图片源站；加载失败时可重试或打开原图。
