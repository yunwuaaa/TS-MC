<?php
declare(strict_types=1);
session_start();
header('Content-Type: application/json; charset=utf-8');

$action = $_REQUEST['action'] ?? '';
function out(array $d): void { echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }

$dataDir = __DIR__ . '/data';
if (!is_dir($dataDir)) @mkdir($dataDir, 0777, true);
$boardFile = $dataDir . '/leaderboard.json';

switch ($action) {
    case 'verify':
        $guess = trim((string)($_POST['code'] ?? ''));
        $secret = (string)($_SESSION['code'] ?? '');
        if ($secret === '') out(['ok' => false, 'msg' => '会话已过期，请刷新页面']);
        if (!hash_equals($secret, $guess)) out(['ok' => false, 'msg' => '密码错误']);

        $start   = (float)($_SESSION['start_ts'] ?? microtime(true));
        $elapsed = (int)max(0, round(microtime(true) - $start));

        $board = is_file($boardFile)
            ? json_decode((string)file_get_contents($boardFile), true) : [];
        if (!is_array($board)) $board = [];
        $board[] = ['time' => $elapsed, 'date' => date('Y-m-d H:i')];
        usort($board, fn($a, $b) => $a['time'] <=> $b['time']);
        $board = array_slice($board, 0, 20);
        @file_put_contents(
            $boardFile,
            json_encode($board, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE),
            LOCK_EX
        );

        out(['ok' => true, 'elapsed' => $elapsed]);
        break;

    case 'leaderboard':
        $board = is_file($boardFile)
            ? json_decode((string)file_get_contents($boardFile), true) : [];
        if (!is_array($board)) $board = [];
        out(['ok' => true, 'board' => $board]);
        break;

    default:
        out(['ok' => false, 'msg' => '未知操作']);
}