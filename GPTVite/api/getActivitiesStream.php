<?php
// api/getActivitiesStream.php
// Même entrée que getActivities.php, mais les activités sont renvoyées une par une (une ligne JSON chacune)
// dès que l'IA a fini de les écrire, pour les faire apparaître en direct sur la carte.

ini_set('display_errors', 0); // une erreur PHP affichée casserait le flux NDJSON

require_once('config.php');
require_once('activitiesCommon.php');

header("Content-Type: application/x-ndjson; charset=UTF-8");
send_cors_headers();

$request = read_activities_request();
$prompt = build_activities_prompt($request, 'ndjson');

// Envoi immédiat de chaque ligne au navigateur, sans mise en tampon
header("Cache-Control: no-cache");
header("X-Accel-Buffering: no"); // désactive le tampon de nginx
@ini_set('zlib.output_compression', '0');
while (ob_get_level() > 0) {
    ob_end_flush();
}
ob_implicit_flush(true);
set_time_limit(120);

$sseBuffer = '';   // flux brut renvoyé par l'API d'IA (Server-Sent Events)
$lineBuffer = '';  // texte de l'IA pas encore terminé par un retour à la ligne
$fullText = '';    // texte complet de l'IA, si elle ne respecte pas le format ligne par ligne
$rawResponse = ''; // début de la réponse brute, pour le message d'erreur
$sent = 0;

$emit = function (array $activity) use (&$sent) {
    echo json_encode($activity, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
    flush();
    $sent++;
};

$onChunk = function ($ch, string $chunk) use (&$sseBuffer, &$lineBuffer, &$fullText, &$rawResponse, $emit) {
    if (strlen($rawResponse) < 4000) {
        $rawResponse .= $chunk;
    }
    $sseBuffer .= $chunk;

    while (($eventEnd = strpos($sseBuffer, "\n")) !== false) {
        $event = trim(substr($sseBuffer, 0, $eventEnd));
        $sseBuffer = substr($sseBuffer, $eventEnd + 1);
        if (strpos($event, 'data:') !== 0) {
            continue;
        }
        // "data: [DONE]" donne null, sans contenu
        $payload = json_decode(trim(substr($event, 5)), true);
        $delta = $payload['choices'][0]['delta']['content'] ?? '';
        if ($delta === '') {
            continue;
        }
        $fullText .= $delta;
        $lineBuffer .= $delta;

        while (($lineEnd = strpos($lineBuffer, "\n")) !== false) {
            $activity = parse_activity_line(substr($lineBuffer, 0, $lineEnd));
            $lineBuffer = substr($lineBuffer, $lineEnd + 1);
            if ($activity) {
                $emit($activity);
            }
        }
    }
    return strlen($chunk);
};

$ch = curl_init(ai_api_url());
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ai_headers(),
    CURLOPT_POSTFIELDS => json_encode(ai_request_data($prompt, true)),
    CURLOPT_WRITEFUNCTION => $onChunk,
]);

$ok = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);

if ($ok === false || $httpCode !== 200) {
    if (!headers_sent()) {
        http_response_code(502);
    }
    echo json_encode([
        "error" => "Erreur lors de la récupération des activités",
        "details" => $curlError ?: $rawResponse,
    ], JSON_UNESCAPED_UNICODE) . "\n";
    exit();
}

// Dernière ligne, si l'IA n'a pas terminé par un retour à la ligne
$activity = parse_activity_line($lineBuffer);
if ($activity) {
    $emit($activity);
}

if ($sent === 0) {
    foreach (parse_activities_text($fullText) as $activity) {
        $emit($activity);
    }
}

if ($sent === 0) {
    echo json_encode([
        "error" => "L'API n'a pas renvoyé d'activité valide.",
        "details" => $fullText,
    ], JSON_UNESCAPED_UNICODE) . "\n";
}
