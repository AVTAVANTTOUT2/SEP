<?php
// api/getActivities.php

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

header("Content-Type: application/json; charset=UTF-8");
require_once('config.php');
require_once('activitiesCommon.php');

send_cors_headers();

$request = read_activities_request();

// Construire le prompt pour l'API d'IA (énergie du jour et météo comprises)
$prompt = build_activities_prompt($request, 'json');

$apiUrl = ai_api_url();
$requestData = ai_request_data($prompt, false);

$ch = curl_init($apiUrl);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ai_headers());
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($requestData));

$response = curl_exec($ch);

if ($response === false) {
    http_response_code(500);
    echo json_encode(["error" => "Erreur cURL", "details" => curl_error($ch)]);
    exit();
}

$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

if ($httpCode !== 200) {
    http_response_code($httpCode);
    echo json_encode(["error" => "Erreur lors de la récupération des activités", "details" => $response]);
    exit();
}

$apiResponse = json_decode($response, true);

if (isset($apiResponse['error'])) {
    http_response_code(500);
    echo json_encode(["error" => "Erreur de l'API", "details" => $apiResponse['error']]);
    exit();
}

$assistantReply = $apiResponse['choices'][0]['message']['content'] ?? null;

if (!$assistantReply) {
    http_response_code(500);
    echo json_encode(["error" => "Réponse inattendue de l'API", "details" => $apiResponse]);
    exit();
}

$suggestions = json_decode($assistantReply, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(500);
    echo json_encode([
        "error" => "L'API n'a pas renvoyé un JSON valide.",
        "details" => $assistantReply
    ]);
    exit();
}

if (!isset($suggestions['activities']) || !is_array($suggestions['activities'])) {
    http_response_code(500);
    echo json_encode(["error" => "Format des activités invalide.", "details" => $suggestions]);
    exit();
}



echo json_encode($suggestions);
