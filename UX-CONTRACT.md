# 821 刷题 UX Contract

## Business context sources

用户会话：只学习821，3–7天；catalog.json 与 learning_outline.json：485题/21章；05-题库疑点与图片依赖.md：人工核对规则。v2 增加自建服务器账号及跨设备进度同步；未登录时仍使用浏览器本地进度。导入、清空在登录时会同步修改本账号的服务器进度，确认弹窗明确说明影响范围。

## Canonical UI Map

| Capability     | Canonical owner                              | Source of truth | Allowed variants                  | Verification                    |
| -------------- | -------------------------------------------- | --------------- | --------------------------------- | ------------------------------- |
| Select/Listbox | App practice-toolbar native select           | DESIGN.md       | native                            | browser keyboard and open popup |
| Form           | App practice-toolbar and Quiz written-answer | UX-CONTRACT.md  | filter / answer                   | typecheck + browser             |
| Scrollbar      | src/styles.css global baseline               | DESIGN.md       | natural document / table overflow | computed style                  |
| Toast          | App single live-region                       | UX-CONTRACT.md  | info / error                      | browser import failure          |
| CRUD           | progress.ts and App transitions              | UX-CONTRACT.md  | answer / favorite / progress      | tests + browser                 |

## Flow and state ledger

- 章节、题型、题量与题单原子更新；搜索通过提交表单应用。章节/随机/错题/收藏保留各模式题单和位置，精讲与数据页返回继续原轮。重新开始仅清空本轮作答，历史和收藏保留。
- 登录使用同源 HttpOnly Cookie；按账号隔离浏览器缓存和服务器数据。首次登录可手动迁移未登录进度，不自动覆盖账号记录。
- 后端使用 revision 比较后保存；其他设备同步和本机修改冲突时暂停覆盖，可备份双方并明确选择版本。离线时本地缓存保留，联机重试。身份变化必须拒绝向错误账号提交。
- 多选按答案集合全对才正确；填空按空的顺序、题面大小写要求；判断按题庫文本。
- 461题自动判分，20图形题和Q52/188/237/399人工核对；人工核对不参与正确率。
- 未作答不能核对可判分题；人工核对可直接查看。核对后锁定选择，重新作答解锁；答错进入待订正，答对移出，历史次数保留。
- 原题图片在选项前；答案图和原始答案只能核对后出现。原图失败保持重试入口，不伪造图像内容。
- 浏览器刷新恢复同一题位置与作答；存储失败显示可导出提示。其他标签页更新时提示选择版本，未选择不覆盖。
- 导出立即下载JSON；导入先验证再弹窗说明替换数量，可取消和备份；清空弹窗默认关闭按钮/保留进度优先。
- 初始加载有状态文本；失败可重试，15秒超时；筛选无匹配显示0条并禁用开始练习；错题/收藏为空有进入练习入口。
- 桌面/手机功能一致。快捷键不拦截文字输入、IME、组合键或弹窗；可用按钮完成所有动作。
- showModal提供焦点隔离、Escape关闭和焦点恢复；通知使用统一中文role=status。导出文件以浏览器本地日期命名。
- 学习精讲内容不是通过标记，统计明确表示已核对和覆盖；未掌握状态不自动写入旧备考工作区。
