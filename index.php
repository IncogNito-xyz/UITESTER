<?php
// The interactive renderer runs on the same PC as the workstation.
if (in_array($_SERVER['REMOTE_ADDR'] ?? '', ['::1', '127.0.0.1', '::ffff:127.0.0.1'], true)) {
    $options = stream_context_create(['http' => ['timeout' => 0.4, 'follow_location' => 0]]);
    $destination = null;
    foreach ([4317, 4318] as $port) {
        $url = 'http://127.0.0.1:' . $port . '/';
        $result = @file_get_contents($url . 'api/status', false, $options);
        $status = $result === false ? null : json_decode($result, true);
        if (($status['app'] ?? '') !== 'forma') {
            continue;
        }
        $destination ??= $url;
        if (($status['display'] ?? false) === true) {
            $destination = $url;
            break;
        }
    }
    if ($destination !== null) {
        header('Cache-Control: no-store');
        header('Location: ' . $destination);
        exit;
    }
}
readfile(__DIR__ . '/index.html');

