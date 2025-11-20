import fs from "fs";
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = 'https://data.collectiveaudience.co/questions/6915f36b9469010001e79e1d?request_method=get&nuid=be65a282-9394-42c1-bc8a-615529df635b&sdk_version=12.8.15';
const INTERVAL_MS = 30 * 1000; // toutes les 30 secondes

// Stockage en mémoire pour le graphique
const history = [];
const MAX_HISTORY = 2000; // jusqu'à 2000 points

// Clients SSE
const clients = [];

// CSV
const CSV_FILE = "votes.csv";
const CANDIDATES = [
  "Serena Villata",
  "François Hug",
  "Cornelia Meinert",
  "Pr Gauci",
  "Jean-Baptiste Caillau",
  "Lise Arena",
  "Cédric Richard",
  "Agnès Festré"
];

if (!fs.existsSync(CSV_FILE)) {
  fs.writeFileSync(CSV_FILE, `timestamp,${CANDIDATES.join(",")}\n`);
}

// Extraire les votes depuis le JSON
function extractVotes(json) {
  const out = {};
  if (!json?.choices || !Array.isArray(json.choices)) return out;

  for (const choice of json.choices) {
    // extraire seulement les deux premiers mots pour le nom
    let rawName = choice.value?.split("\n")[0]?.split(":")[0]?.trim() ?? "inconnu";
    let name = rawName.split(" ").slice(0, 2).join(" "); // 2 premiers mots
    const votes = Number(choice.statistics?.opinions ?? 0);
    out[name] = votes;
  }
  return out;
}

// Sauvegarde dans le CSV
function saveToCSV(snapshot) {
  const line = [
    snapshot.timestamp,
    ...CANDIDATES.map(name => snapshot.votes[name] ?? 0)
  ].join(",") + "\n";

  fs.appendFile(CSV_FILE, line, err => {
    if (err) console.error("Erreur écriture CSV:", err);
  });
}

// Broadcast SSE
function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const res of clients) {
    try { res.write(`data: ${data}\n\n`); } catch(e) {}
  }
}

// Récupération de l'API
async function fetchOnceAndStore() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) return console.error("Erreur HTTP:", res.status, res.statusText);

    const data = await res.json();
    console.log("Réponse API récupérée");

    const votes = extractVotes(data);
    if (Object.keys(votes).length === 0) return;

    const ts = new Date().toISOString();
    const snapshot = { timestamp: ts, votes };

    // Ajouter en mémoire
    history.push(snapshot);
    if (history.length > MAX_HISTORY) history.shift();

    // Envoyer aux clients SSE
    broadcast({ type: "update", payload: snapshot });

    // Sauvegarder dans le CSV
    saveToCSV(snapshot);

    console.log(`${ts} — snapshot ajouté`, votes);
  } catch (err) {
    console.error("Erreur fetch:", err?.message ?? err);
  }
}

// Boucle continue
async function startPolling() {
  console.log("Polling toutes les", INTERVAL_MS / 1000, "secondes.");
  while (true) {
    await fetchOnceAndStore();
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}

// SSE pour le front
app.use(express.static("public"));

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // envoyer l'historique en mémoire
  res.write(`data: ${JSON.stringify({ type: "init", payload: history })}\n\n`);
  clients.push(res);

  req.on("close", () => {
    const idx = clients.indexOf(res);
    if (idx !== -1) clients.splice(idx, 1);
  });
});

// Optionnel : reset mémoire sans toucher au CSV
app.get("/reset-memory", (req, res) => {
  history.length = 0;
  res.send("Mémoire effacée !");
});

app.listen(PORT, () => {
  console.log(`Serveur lancé : http://localhost:${PORT}`);
  startPolling();
});

