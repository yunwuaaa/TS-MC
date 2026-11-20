# 老宅 · 三层（Haunted Manor）

一个用 **PHP + Three.js** 写的浏览器第一人称恐怖逃生小游戏。你被困在一栋三层老宅里，
手电快没电了，屋里的「她」听得见你的一切动静。找到撬棍、纸条线索和密码，从前门逃出去。

玩法灵感来自《恐怖奶奶》(Granny)，全部 3D 场景、AI、音效均在浏览器端实时生成，**没有任何图片、模型或音频素材文件**。

![PHP](https://img.shields.io/badge/PHP-7.0+-777BB4?logo=php&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-r160-black?logo=three.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)
![No Build](https://img.shields.io/badge/build-none-brightgreen)

---

## ✨ 特性

- **零素材、零构建** —— 场景全部用 Three.js 基础几何体拼出来，音效由 WebAudio 现场合成，不需要下载任何资源，也不需要 webpack/vite
- **服务端密码** —— 每局密码由 PHP `random_int()` 生成并存在 session 里，前端只拿到一个随机数，改前端源码作弊无效
- **噪音潜行系统** —— 奔跑产生噪音，噪音条越满越容易被发现；蹲下潜行几乎无声
- **带听觉的 AI** —— 「她」会巡逻、循声追击；换楼层时在远离你的随机位置刷新，现身前 1.5 秒有声音 + 文字预警
- **消防斧** —— 藏在二层卧室，鼠标左键挥击，三斧能把她劈倒，但 9 秒后会满血复活，倒地时间是你逃向出口的窗口
- **在线排行榜** —— 通关耗时写入服务端 JSON，文件锁防并发写坏
- **性能优化** —— 几何体与材质全局缓存复用、InstancedMesh 批量画墙、手电抖动降频计算

## 🎮 操作

| 按键 | 功能 |
|---|---|
| `WASD` | 移动 |
| 鼠标 | 视角（点击画面锁定指针） |
| `Shift` | 奔跑（噪音大） |
| `Ctrl` | 蹲下潜行（安静） |
| `E` | 互动（拾取 / 开门 / 上下楼 / 开箱） |
| 鼠标左键 | 挥斧（需先拾到消防斧） |
| `ESC` | 释放鼠标 |

**通关条件**：拿到撬棍撬开前门铁链 → 用纸条/线索推出密码 → 在密码锁上输入三位数字 → 逃出大门。

## 📁 项目结构

```
haunted-manor/
├── index.php          # 入口：生成会话密码、输出页面骨架
├── api.php            # 后端接口：verify（校验密码+记录成绩）/ leaderboard（读榜）
├── assets/
│   ├── game.js        # 游戏主体（约 1300 行）：地图、渲染、玩家、AI、音效、武器
│   └── style.css      # 暗黑恐怖风 UI：HUD、暗角、危险红闪、密码键盘
├── LICENSE            # MIT
├── .gitignore
└── README.md
```

运行后会自动生成（已被 .gitignore 忽略）：

```
data/leaderboard.json  # 排行榜数据
```

## 🚀 运行

需要 **PHP 7.0+**（用了 `declare(strict_types=1)`、箭头函数、`random_int`），**不需要数据库、不需要 Composer**。
浏览器需支持 ES Module 与 WebGL（Chrome / Edge / Firefox / Safari 新版均可）。

### 方式一：PHP 内置服务器（本地试玩最快）

```bash
git clone https://github.com/你的用户名/你的仓库名.git
cd 你的仓库名
php -S 127.0.0.1:8000
```

打开 <http://127.0.0.1:8000/index.php> 即可。**必须通过 `index.php` 进入**，直接打开 html 或未走 PHP 的静态服务器会导致会话密码为空、点开始后提示「会话已过期」。

### 方式二：Apache / Nginx

把整个目录放到站点根下，确保：

- PHP 能正常解析 `.php`
- `data/` 目录对 PHP 进程**可写**（排行榜要落盘）
- 已启用 session（默认即可）

```bash
# 若提示排行榜写不进去：
mkdir -p data && chmod 777 data
```

### 关于 Three.js CDN

`game.js` 顶部按序尝试 4 个 CDN，前一个失败自动换下一个，国内网络基本能通：

```
unpkg.com → cdn.jsdelivr.net → fastly.jsdelivr.net → esm.sh
```

若要完全离线，把 `three.module.js` 下到本地，改掉 `loadThree()` 里的 `urls` 数组即可。

## 🗺️ 地图怎么改

三层地图就是 `game.js` 里的三个字符串数组，**改字符等于改关卡**，这是最好玩的地方：

| 字符 | 含义 |
|---|---|
| `#` | 墙 |
| `.` | 地板 |
| `D` | 前门（出口） |
| `S` / `s` | 上楼 / 下楼 |
| `A` / `a` | 上阁楼 / 下阁楼 |
| `B` | 矮柜 |
| `W` | 衣柜 |
| `T` | 桌子 |

数组固定 19 列 × 15 行，改完保持每行等长即可，家具和楼梯的 3D 模型会自动生成。

## 🛠️ 可调参数速查

| 想调什么 | 改哪里 |
|---|---|
| 难度（她多快找上你） | `goToFloor()` 里的 `granny.followTimer = 4.5` |
| 刷新距离 | `updateGranny()` 里 `d > 10 * TILE` 的 `10` |
| 斧头伤害 / 击晕 / 冷却 | `WEAPONS.fireaxe` 的 `damage` / `stun` / `cooldown` |
| 倒地时长 | `grannyDown()` 里的 `9000`（毫秒） |
| 斧头位置 | `ITEMS` 数组里 `fireaxe` 的 `gx` / `gz` |
| 密码位数范围 | `index.php` 里的 `random_int(100, 999)` |
| 排行榜容量 | `api.php` 里的 `array_slice($board, 0, 20)` |

## ⚠️ 安全说明

这是一个**单机解谜 Demo**，服务端只做密码校验和成绩记录，因此：

- `data/leaderboard.json` 是**全局共享**的，任何人都能提交成绩，没有防刷机制
- `verify` 接口没有做频率限制，公开部署时建议自行加限流
- 若对外开放，建议把 `data/` 移到 Web 根目录之外

## 🤝 贡献

欢迎提 Issue 和 PR。想加东西的话，这些方向最容易上手：

- 新增道具（照着 `ITEMS` 数组和 `makeItemMesh()` 加即可）
- 给奶奶加更多状态（比如听到门响会去查看）
- 增加更多楼层 / 换皮主题（废弃医院、地下室…）
- 排行榜加防刷与去重

## 📄 License

[MIT](./LICENSE) © 2026 Yuanbao Contributors

Three.js 使用 MIT 许可证，见 [three.js](https://github.com/mrdoob/three.js)。
