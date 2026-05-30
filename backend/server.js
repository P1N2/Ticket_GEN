const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

// Middleware
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// HTTP server + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: FRONTEND_ORIGIN,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
    }
});
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Helper to broadcast participants state to connected sockets
function broadcastParticipants() {
    db.all("SELECT * FROM participants ORDER BY createdAt DESC", (err, rows) => {
        if (!err) {
            io.emit('participants:changed', rows);
        }
    });
}

// ============================================================
// BASE DE DONNÉES SQLITE
// ============================================================
const db = new sqlite3.Database(path.join(__dirname, 'tickets.db'));

// Créer la table participants
db.run(`
    CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nom TEXT NOT NULL,
        dateNaissance TEXT,
        eglise TEXT,
        numero TEXT,
        qrCode TEXT UNIQUE,
        scanned BOOLEAN DEFAULT 0,
        ticketGenerated BOOLEAN DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`, (err) => {
    if (err) {
        console.error('❌ Erreur création table:', err.message);
    } else {
        console.log('✅ Base de données SQLite prête');
        
        // Créer l'index pour éviter les doublons
        db.run(`CREATE INDEX IF NOT EXISTS idx_nom ON participants(nom)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_scanned ON participants(scanned)`);
    }
});

// ============================================================
// API ROUTES
// ============================================================

// GET - Récupérer tous les participants
app.get('/api/participants', (req, res) => {
    db.all("SELECT * FROM participants ORDER BY createdAt DESC", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// GET - Statistiques
app.get('/api/stats', (req, res) => {
    db.get(`
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN scanned = 1 THEN 1 ELSE 0 END) as scanned,
            SUM(CASE WHEN ticketGenerated = 1 THEN 1 ELSE 0 END) as ticketsGenerated
        FROM participants
    `, (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(row);
    });
});

// POST - Ajouter un participant (manuel)
app.post('/api/participants', (req, res) => {
    const { nom, dateNaissance, eglise, numero } = req.body;
    
    if (!nom) {
        res.status(400).json({ error: 'Le nom est obligatoire' });
        return;
    }
    
    // Vérifier doublon
    db.get(`SELECT id FROM participants WHERE nom = ?`, [nom], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (row) {
            res.status(409).json({ error: 'Doublon', message: `Le participant "${nom}" existe déjà` });
            return;
        }
        
        const qrCode = `TICKET_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        
        db.run(
            `INSERT INTO participants (nom, dateNaissance, eglise, numero, qrCode) 
             VALUES (?, ?, ?, ?, ?)`,
            [nom, dateNaissance || '', eglise || '', numero || '', qrCode],
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }
                res.json({ id: this.lastID, qrCode, success: true });
                // broadcast
                broadcastParticipants();
            }
        );
    });
});

// POST - Ajouter plusieurs participants (import CSV)
app.post('/api/participants/batch', (req, res) => {
    const participantsList = req.body;
    
    if (!participantsList || participantsList.length === 0) {
        res.status(400).json({ error: 'Aucun participant à ajouter' });
        return;
    }
    
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO participants (nom, dateNaissance, eglise, numero, qrCode) 
        VALUES (?, ?, ?, ?, ?)
    `);
    
    let successCount = 0;
    let duplicates = [];
    
    participantsList.forEach(p => {
        const qrCode = `TICKET_${Date.now()}_${Math.random().toString(36).substr(2, 8)}_${p.nom.replace(/\s/g, '')}`;
        stmt.run([p.nom, p.dateNaissance || '', p.eglise || '', p.numero || '', qrCode], function(err) {
            if (!err && this.changes > 0) {
                successCount++;
            } else if (err && err.message.includes('UNIQUE')) {
                duplicates.push(p.nom);
            }
        });
    });
    
    stmt.finalize();
    
    setTimeout(() => {
        res.json({ success: true, count: successCount, duplicates });
        // broadcast new participants
        broadcastParticipants();
    }, 500);
});

// PUT - Marquer un ticket comme scanné
app.put('/api/participants/:id/scan', (req, res) => {
    const { id } = req.params;
    
    // Vérifier si déjà scanné
    db.get(`SELECT scanned, nom FROM participants WHERE id = ?`, [id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (!row) {
            res.status(404).json({ error: 'Participant non trouvé' });
            return;
        }
        
        if (row.scanned === 1) {
            res.json({ success: true, alreadyScanned: true, message: `${row.nom} a déjà été scanné` });
            return;
        }
        
        db.run(`UPDATE participants SET scanned = 1 WHERE id = ?`, [id], function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ success: true, alreadyScanned: false, message: `${row.nom} a été validé` });
            broadcastParticipants();
        });
    });
});

// PUT - Marquer qu'un ticket a été généré
app.put('/api/participants/:id/generate', (req, res) => {
    const { id } = req.params;
    
    db.run(`UPDATE participants SET ticketGenerated = 1 WHERE id = ?`, [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true });
        broadcastParticipants();
    });
});

// GET - Récupérer un participant par QR code
app.get('/api/participants/qr/:qrCode', (req, res) => {
    const { qrCode } = req.params;
    
    db.get(`SELECT id, nom, dateNaissance, eglise, scanned FROM participants WHERE qrCode = ?`, [qrCode], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (!row) {
            res.status(404).json({ error: 'QR Code non reconnu' });
            return;
        }
        
        res.json(row);
    });
});

// DELETE - Supprimer un participant
app.delete('/api/participants/:id', (req, res) => {
    const { id } = req.params;
    
    db.run(`DELETE FROM participants WHERE id = ?`, [id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true });
        broadcastParticipants();
    });
});

// DELETE - Supprimer tous les participants
app.delete('/api/participants', (req, res) => {
    db.run(`DELETE FROM participants`, function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true });
        broadcastParticipants();
    });
});

// ============================================================
// DÉMARRAGE
// ============================================================
server.listen(PORT, () => {
    console.log(`
    ┌─────────────────────────────────────────────────────┐
    │   🚀 SERVEUR DÉMARRÉ AVEC SUCCÈS !                  │
    ├─────────────────────────────────────────────────────┤
    │   📡 API: http://localhost:${PORT}/api               │
    │   🌐 Frontend origin allowed: ${FRONTEND_ORIGIN}    │
    │   📁 Base de données: tickets.db                    │
    └─────────────────────────────────────────────────────┘
    `);
});