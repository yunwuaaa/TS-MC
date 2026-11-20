<?php
declare(strict_types=1);
session_start();
$_SESSION['code'] = (string)random_int(100, 999);
$_SESSION['start_ts'] = microtime(true);
$code = $_SESSION['code'];
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>老宅 · 三层</title>
  <link rel="stylesheet" href="assets/style.css">
</head>
<body>
  <div id="app"></div>
  <div id="crosshair"></div>
  <div id="weaponView"></div>
  <div id="vignette"></div>
  <div id="danger"></div>
  <div id="flash"></div>
  <div id="fade"></div>

  <div id="hud">
    <div><span class="label">楼层</span> <span class="val" id="floorName">一层</span></div>
    <div><span class="label">状态</span> <span class="val" id="statusText">潜行中</span></div>
    <div><span class="label">道具</span> <span class="val" id="invText">无</span></div>
    <div><span class="label">噪音</span></div>
    <div id="noiseBarWrap"><div id="noiseBar"></div></div>
  </div>

  <div id="prompt"></div>

  <div id="overlay">
    <h1>老宅</h1>
    <p>
      <span class="key">WASD</span> 移动 · <span class="key">鼠标</span> 视角 · <span class="key">Shift</span> 奔跑<br>
      <span class="key">Ctrl</span> 蹲下潜行 · <span class="key">E</span> 互动 · <span class="key">ESC</span> 释放鼠标<br>
      <span class="key">鼠标左键</span> 挥斧反击（捡到消防斧后）<br><br>
      她听得见。找到钥匙、撬棍和密码，从前门逃出去。<br>
      实在躲不掉，就给她一斧子——但她会站起来。
    </p>
    <div id="startBtn">正在加载引擎…</div>
  </div>

  <div id="winScreen">
    <h1>你逃出去了</h1>
    <p>门外是凌晨三点的街道。<br>身后的门，慢慢合上了。</p>
    <p id="winStats" style="margin-top:18px;color:#444;font-size:14px"></p>
    <p style="margin-top:20px;color:#999;font-size:13px">点击重新开始</p>
  </div>

  <div id="err"></div>

  <div id="keypad">
    <div class="kp-panel">
      <div class="kp-title">密 码 锁</div>
      <div class="kp-display" id="kpDisplay">_ _ _</div>
      <div class="kp-grid">
        <button data-k="1">1</button><button data-k="2">2</button><button data-k="3">3</button>
        <button data-k="4">4</button><button data-k="5">5</button><button data-k="6">6</button>
        <button data-k="7">7</button><button data-k="8">8</button><button data-k="9">9</button>
        <button data-k="C">C</button><button data-k="0">0</button><button data-k="E">✓</button>
      </div>
      <button id="kpClose">离开</button>
    </div>
  </div>

  <script>window.GAME_CONFIG = <?= json_encode(['code' => $code], JSON_UNESCAPED_UNICODE) ?>;</script>
  <script type="module" src="assets/game.js"></script>
</body>
</html>