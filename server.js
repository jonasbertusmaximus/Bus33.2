const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = './bus_data.json';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const API = 'https://transport.opendata.ch/v1';
const STATIONS = [
  { name: 'Klosbach', id: '8591231' },
  { name: 'Römerhof', id: '8591324' }
];

// Initialisiere Datenspeicher
function initDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

// Lese alle Daten
function readData() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Speichere Daten
function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Fehler beim Speichern:', e);
  }
}

// Hole Bus 33 Daten von API
async function fetchLine33(stationId, stopName) {
  try {
    const r = await fetch(`${API}/stationboard?id=${stationId}&limit=50`);
    if (!r.ok) throw new Error(`HTTP Fehler ${r.status}`);
    const d = await r.json();
    const board = d.stationboard ?? [];
    const now = new Date();

    return board
      .filter(e => {
        const nr = String(e.number ?? '').trim();
        const ln = String(e.line ?? '').trim();
        return nr === '33' || ln === '33' || nr.includes('33') || ln.includes('33');
      })
      .map(e => {
        const stop = e.stop ?? {};
        const planned = stop.departure;
        if (!planned) return null;

        const plannedDt = new Date(planned);
        const progRaw = stop.prognosis?.departure;
        const actualDt = progRaw ? new Date(progRaw) : plannedDt;
        const delayMin = Math.round((actualDt - plannedDt) / 60000);

        return {
          key: `${stopName}_${planned}`,
          stop: stopName,
          planned: plannedDt.toISOString(),
          delay: delayMin,
          direction: e.to ?? '',
          category: e.category ?? '',
          departed: actualDt <= now,
          fetchedAt: new Date().toISOString()
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.error(`Fehler beim Abrufen von ${stopName}:`, e.message);
    return [];
  }
}

// Automatische Datensammlung alle 10 Minuten
async function collectData() {
  console.log(`[${new Date().toLocaleTimeString('de-CH')}] Sammle Daten...`);
  
  let existingData = readData();
  const todayStr = new Date().toISOString().slice(0, 10);
  
  // Filtere alte Daten aus
  existingData = existingData.filter(p => p.planned.startsWith(todayStr));

  for (const station of STATIONS) {
    try {
      const fresh = await fetchLine33(station.id, station.name);
      const keys = new Set(existingData.map(p => p.key));
      const uniqueFresh = fresh.filter(p => !keys.has(p.key));
      
      existingData = [...existingData, ...uniqueFresh];
      console.log(`  ✓ ${station.name}: ${uniqueFresh.length} neue Datenpunkte`);
    } catch (e) {
      console.error(`  ✗ Fehler bei ${station.name}:`, e.message);
    }
  }

  saveData(existingData);
  console.log(`  → Gesamt gespeichert: ${existingData.length} Datenpunkte`);
}

// Starte Datensammlung sofort und dann alle 10 Minuten
initDataFile();
collectData(); // Erste Sammlung sofort
setInterval(collectData, 10 * 60 * 1000); // Danach alle 10 Minuten

// API Endpoints

// GET: Alle heute gesammelten Daten
app.get('/api/data', (req, res) => {
  const data = readData();
  res.json(data);
});

// GET: Gefilterte Daten für eine Station
app.get('/api/data/:station', (req, res) => {
  const data = readData();
  const filtered = data.filter(p => p.stop === req.params.station);
  res.json(filtered);
});

// GET: Statistiken
app.get('/api/stats', (req, res) => {
  const data = readData();
  const count = data.length;
  const delays = data.map(p => p.delay);
  
  const stats = {
    count: count,
    avg: count ? (delays.reduce((a, b) => a + b, 0) / count).toFixed(1) : 0,
    ontime: count ? ((delays.filter(d => d <= 0).length / count) * 100).toFixed(1) : 0,
    max: count ? Math.max(...delays) : 0,
    lastUpdate: data.length ? data[data.length - 1].fetchedAt : null
  };
  res.json(stats);
});

// GET: Status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    nextUpdate: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    dataPoints: readData().length
  });
});

// Starte Server
app.listen(PORT, () => {
  console.log(`🚌 Bus 33 Server läuft auf http://localhost:${PORT}`);
  console.log(`📊 Daten werden alle 10 Minuten automatisch gespeichert`);
  console.log(`📁 Datenspeicher: ${DATA_FILE}`);
});
