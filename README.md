# 🐟 dsh-pet — DeepSeek 余额桌面宠物

> 爱吃白饭的蓝色大肥鱼：DSH Web 的桌面宠物插件，实时汇报你的 DeepSeek 余额。

## 功能

- 🐟 页面右下角常驻的蓝色大肥鱼（可**拖拽**、可**翻转**，转向屏幕中心）
- 💬 气泡**随机可爱发言**，实时显示 DeepSeek 账户余额，例如：
  - 「白饭就剩¥110.00了！」
  - 「今天的口粮还有¥110.00，够吃~」
  - 「咕噜…白饭就剩¥110.00了，好想吃！」
- 👆 **点击抚摸** → 爱心动画 + 立即刷新余额
- 峰谷时段提示：按 DeepSeek 官方定价规则实时标注当前时段，并倒计时到下一次切换
  - 高峰：北京时间周一至周五（不含中国法定节假日）9:00-12:00、14:00-18:00
  - 空闲：其余所有时段（含周末与中国法定节假日全天），价格为高峰的一半
  - 放假数据**实时抓取**（依次尝试 holiday-cn / jiejiariapi / timor.tech，节点半缓存 6 小时，跨年自动获取），并内置 2026 年日历作为离线兜底
- 投喂按钮：一键跳转 DeepSeek 官方充值页，文案在「投喂白饭」等几条之间轮换
- 🎨 气泡**主题自适应**（跟随 DSH 亮/暗主题）
- ⏱️ 每 5 分钟自动静默刷新
- 🔝 最高层级，不被任何 UI 覆盖

## 架构

- **节点半**（`src/index.ts`）：通过 webServer 注册 `/dsh-pet/balance` 路由，使用 DSH 凭据服务解析 `DEEPSEEK_API_KEY` 后请求官方余额 API —— **密钥不落地浏览器**。
- **浏览器半**（`src/client/index.ts`）：纯 DOM 实现宠物 UI（无 React 依赖），图片以内联 data URL 打包。

## 安装

```bash
# 从 GitHub 安装
dsh plugin --profile web add git+https://github.com/BOXLINEovo/dsh-pet.git

# 或本地目录（开发模式）
dsh plugin --profile web add /path/to/dsh-pet
```

安装后**重启 DSH Web** 生效。

## 构建

```bash
pnpm install
pnpm build
# 产物：lib/index.js（节点半）+ lib/client.js（浏览器半）
```

## 动画素材管线（可选）

想把静态立绘换成**真正会动的动画**，只需提供一段循环视频：

```bash
pnpm anim <你的视频.mp4> --fps 12 --width 340
pnpm build
```

脚本会自动完成：抽帧 → **逐帧抠底**（从四边泛洪 + 边缘羽化，自动识别背景色）→ 合成**透明动画 WebP** → 更新 `src/client/pet-art.generated.ts`（客户端 `<img>` 原生播放，无需改代码）。

**录制/生成视频的建议**：

- 背景用**纯色**（白或绿），越干净抠得越准；不要用渐变或实景
- 首尾帧尽量一致，做到**无缝循环**（单个循环 2~4 秒最适合待机）
- 角色基本居中、不出画，分辨率不低于 512px 宽
- 内容以**待机动作**为主：轻微起伏、摆尾、眨眼、头发飘动

常用参数：`--bg white|green|#RRGGBB|auto`（默认 auto，取四角颜色）、`--tolerance 45`（背景容差）、`--quality 80`（WebP 质量）、`--keep-frames`（保留中间帧便于排查）。

## 素材版权

角色图片来源于 **B 站 UP 主「这个刀子真甜」**：

- Bilibili 主页：https://space.bilibili.com/23315338

图片仅作标注使用，**版权归原作者所有**；MIT 许可仅覆盖本插件的代码，不包含图片素材。再分发/商用图片请先取得原作者授权。详见 [NOTICE](./NOTICE)。

## 许可

代码：MIT License，见 [LICENSE](./LICENSE)。
