<?php
// api/activitiesCommon.php
// Code partagé par getActivities.php et getActivitiesStream.php

define('DEFAULT_AI_API_URL', 'https://api.openai.com/v1/chat/completions');
define('DEFAULT_AI_MODEL', 'gpt-3.5-turbo');
define('ACTIVITY_COUNT', 5);

function send_cors_headers(): void
{
    header("Access-Control-Allow-Origin: *");
    header("Access-Control-Allow-Methods: POST, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization");

    // Requête de pré-vérification CORS envoyée par le navigateur avant le POST
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit();
    }
}

function fail(int $httpCode, string $message): void
{
    http_response_code($httpCode);
    echo json_encode(["error" => $message], JSON_UNESCAPED_UNICODE);
    exit();
}

// Lit et valide le corps JSON envoyé par l'application
function read_activities_request(): array
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail(405, "Méthode non autorisée");
    }

    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        fail(400, "Données invalides");
    }

    foreach (['latitude', 'longitude', 'north', 'south', 'east', 'west'] as $key) {
        if (!isset($input[$key]) || !is_numeric($input[$key])) {
            fail(400, "Latitude, longitude et les limites de la carte sont requis.");
        }
    }

    $userInfo = is_array($input['userInfo'] ?? null) ? $input['userInfo'] : [];
    $weather = is_array($input['weather'] ?? null) ? $input['weather'] : null;

    return [
        'latitude' => (float) $input['latitude'],
        'longitude' => (float) $input['longitude'],
        'ability' => trim((string) ($userInfo['ability'] ?? '')) ?: "aucune capacité spécifiée",
        'activityPreferences' => trim((string) ($userInfo['activityPreferences'] ?? '')),
        'energy' => max(1, min(5, (int) ($userInfo['energy'] ?? 3))),
        'weather' => $weather ? [
            'temperature' => round((float) ($weather['temperature'] ?? 0)),
            'apparentTemperature' => round((float) ($weather['apparentTemperature'] ?? $weather['temperature'] ?? 0)),
            'condition' => in_array($weather['condition'] ?? '', ['chaleur', 'pluie', 'normal'], true) ? $weather['condition'] : 'normal',
        ] : null,
    ];
}

// Jauge « énergie du jour » (théorie des cuillères).
// Les distances doivent rester alignées avec src/energy.ts.
function energy_profile(int $level): array
{
    $profiles = [
        1 => ['label' => "très peu d'énergie", 'meters' => 500, 'distance' => '500 m', 'duration' => '30 minutes', 'intensity' => 'très douce, assise si possible', 'rest' => "Des places assises sur place sont indispensables."],
        2 => ['label' => "un peu d'énergie", 'meters' => 1000, 'distance' => '1 km', 'duration' => '45 minutes', 'intensity' => 'douce', 'rest' => "Il faut des bancs ou des places assises pour faire des pauses fréquentes."],
        3 => ['label' => "une énergie moyenne", 'meters' => 2000, 'distance' => '2 km', 'duration' => '1 h 30', 'intensity' => 'modérée', 'rest' => "Quelques possibilités de pause assise sont bienvenues."],
        4 => ['label' => "une bonne énergie", 'meters' => 5000, 'distance' => '5 km', 'duration' => '2 heures', 'intensity' => 'soutenue possible', 'rest' => ""],
        5 => ['label' => "une pleine forme", 'meters' => 10000, 'distance' => '10 km', 'duration' => 'une demi-journée', 'intensity' => 'soutenue', 'rest' => ""],
    ];
    return $profiles[$level] ?? $profiles[3];
}

function weather_instructions(?array $weather): string
{
    if (!$weather) {
        return "";
    }
    $now = "Météo actuelle : {$weather['temperature']} °C (ressenti {$weather['apparentTemperature']} °C).";
    switch ($weather['condition']) {
        case 'chaleur':
            return "$now Il fait chaud : la chaleur aggrave les symptômes de la sclérose en plaques (phénomène d'Uhthoff). Propose uniquement des lieux climatisés, en intérieur ou très ombragés, sans effort en plein soleil.";
        case 'pluie':
            return "$now Il pleut : propose uniquement des activités en intérieur ou à l'abri.";
        default:
            return "$now Le temps permet aussi des activités en extérieur.";
    }
}

// $format : 'json' (un objet avec un tableau 'activities') ou 'ndjson' (une activité par ligne, pour le streaming)
function build_activities_prompt(array $request, string $format): string
{
    $count = ACTIVITY_COUNT;
    $energy = energy_profile($request['energy']);
    // Les modèles respectent mieux un cadre de coordonnées qu'une distance
    $deltaLat = $energy['meters'] / 111320;
    $deltaLng = $energy['meters'] / (111320 * cos(deg2rad($request['latitude'])));
    $box = sprintf(
        "latitude entre %.4f et %.4f, longitude entre %.4f et %.4f",
        $request['latitude'] - $deltaLat,
        $request['latitude'] + $deltaLat,
        $request['longitude'] - $deltaLng,
        $request['longitude'] + $deltaLng
    );
    $preferencesText = $request['activityPreferences'] !== ''
        ? ", avec des préférences pour les activités suivantes : {$request['activityPreferences']}"
        : "";

    $prompt = "Génère une liste de $count activités adaptées pour une personne ayant la capacité \"{$request['ability']}\", se trouvant à la latitude {$request['latitude']} et la longitude {$request['longitude']}$preferencesText.

Énergie du jour : {$request['energy']}/5 cuillères ({$energy['label']}). Chaque activité doit se trouver à moins de {$energy['distance']} de la personne, durer au maximum {$energy['duration']} et avoir une intensité {$energy['intensity']}. {$energy['rest']}
Toutes les coordonnées doivent rester dans ce cadre : $box. Préfère un lieu tout proche, même moins connu, à un lieu célèbre plus éloigné.
" . weather_instructions($request['weather']) . "

Pour chaque activité, fournis les champs suivants :
- 'name' : nom du lieu ou de l'activité
- 'description' : description de l'activité
- 'lat' et 'lng' : coordonnées géographiques réelles du lieu, proches de la position de l'utilisateur
- 'emoji' : un seul emoji qui représente l'activité
- 'setting' : \"interieur\", \"exterieur\" ou \"mixte\"
- 'duration_minutes' : durée conseillée en minutes (nombre)
- 'intensity' : \"très douce\", \"douce\", \"modérée\" ou \"soutenue\"
- 'seating' : true s'il y a des bancs ou des places assises sur place, sinon false
- 'why' : une phrase courte qui explique pourquoi c'est adapté à son énergie et à la météo du jour
- 'opening_hours' : horaires d'ouverture (si disponibles)
- 'booking_link' : URL pour la réservation en ligne (si disponible)
- 'phone_number' : numéro de téléphone (si disponible)
Classe les activités de la plus proche à la plus éloignée.
";

    if ($format === 'ndjson') {
        $prompt .= "Retourne exactement $count lignes, une par activité. Chaque ligne est un objet JSON complet écrit sur une seule ligne (format NDJSON), sans tableau englobant, sans balises de code et sans texte supplémentaire.";
    } else {
        $prompt .= "Retourne les résultats au format JSON avec un tableau nommé 'activities'. Assure-toi que la sortie est uniquement le JSON sans texte supplémentaire.";
    }

    return $prompt;
}

// Toute API compatible OpenAI (OpenAI, DeepSeek…) se configure dans api/.env.
// Les variables AI_* sont prioritaires ; les anciennes OPENAI_* restent acceptées.
function ai_env(string $name, ?string $default = null): ?string
{
    $value = $_ENV["AI_$name"] ?? $_ENV["OPENAI_$name"] ?? null;
    return ($value === null || $value === '') ? $default : $value;
}

function ai_api_url(): string
{
    return ai_env('API_URL', DEFAULT_AI_API_URL);
}

function ai_request_data(string $prompt, bool $stream): array
{
    $data = [
        "model" => ai_env('MODEL', DEFAULT_AI_MODEL),
        "messages" => [
            [
                "role" => "system",
                "content" => "Tu es un assistant qui aide à trouver des activités adaptées."
            ],
            [
                "role" => "user",
                "content" => $prompt
            ]
        ],
        "temperature" => 0.7,
        // Les modèles qui réfléchissent (DeepSeek V4…) comptent leur réflexion dans ce budget
        "max_tokens" => 4000,
        "stream" => $stream,
    ];

    // Ex. « low » pour DeepSeek : réponse plus rapide, réflexion courte. À ne pas définir pour gpt-3.5-turbo.
    $reasoningEffort = ai_env('REASONING_EFFORT');
    if ($reasoningEffort !== null) {
        $data["reasoning_effort"] = $reasoningEffort;
    }

    return $data;
}

function ai_headers(): array
{
    return [
        'Content-Type: application/json',
        'Authorization: Bearer ' . ai_env('API_KEY', ''),
    ];
}

function is_valid_activity($activity): bool
{
    return is_array($activity)
        && !empty($activity['name'])
        && is_numeric($activity['lat'] ?? null)
        && is_numeric($activity['lng'] ?? null);
}

// Une ligne du flux NDJSON écrit par l'IA → une activité, ou null si la ligne n'en contient pas
function parse_activity_line(string $line): ?array
{
    $line = trim($line);
    // L'IA ajoute parfois des puces, des numéros, des balises de code ou des virgules autour des lignes
    $line = preg_replace('/^(```(json)?|[-*•]\s*|\d+[.)]\s*)/u', '', $line);
    $line = rtrim($line, ", \t");
    if ($line === '' || $line[0] !== '{') {
        return null;
    }
    $activity = json_decode($line, true);
    return is_valid_activity($activity) ? $activity : null;
}

// Dernier recours quand l'IA n'a pas respecté le format ligne par ligne (tableau ou objet 'activities')
function parse_activities_text(string $text): array
{
    $clean = trim(preg_replace('/```(json)?/', '', $text));
    $decoded = json_decode($clean, true);
    $list = is_array($decoded) ? ($decoded['activities'] ?? $decoded) : [];
    return is_array($list) ? array_values(array_filter($list, 'is_valid_activity')) : [];
}
