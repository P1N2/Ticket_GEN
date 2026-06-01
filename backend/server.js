const express = require('express');
require('dotenv').config();
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = '*';

// Mettre à disposition le dossier contenant le code client
app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Serveur HTTP + Configuration de l'instance de Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: FRONTEND_ORIGIN,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        credentials: true
    }
});

// Helper pour diffuser la liste des participants rafraîchie à tous les terminaux connectés
function broadcastParticipants() {
    pool.query('SELECT * FROM participants ORDER BY created_at DESC')
        .then(result => {
            io.emit('participants:changed', result.rows);
        })
        .catch(err => {
            console.error('❌ Erreur broadcast participants:', err.message);
        });
}

// ============================================================
// CONFIGURATION DE LA BASE DE DONNÉES POSTGRESQL (SUPABASE)
// ============================================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function initDb() {
    try {
        // Initialisation de la structure de données
        await pool.query(`
            CREATE TABLE IF NOT EXISTS participants (
                id SERIAL PRIMARY KEY,
                nom_prenom TEXT NOT NULL,
                date_naissance TEXT,
                lieu_naissance TEXT,
                age INTEGER,
                eglise_provenance TEXT,
                numero_telephone TEXT,
                qr_code TEXT UNIQUE,
                scanned BOOLEAN DEFAULT FALSE,
                ticket_generated BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await pool.query(`CREATE INDEX IF NOT EXISTS idx_nom ON participants(nom_prenom)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_scanned ON participants(scanned)`);

        console.log('✅ Base de données PostgreSQL prête');
    } catch (err) {
        console.error('❌ Erreur initialisation base de données PostgreSQL:', err.message);
        process.exit(1);
    }
}

initDb();

// ============================================================
// ROUTES DE L'API REST
// ============================================================

// GET - Extraire l'intégralité des participants enregistrés
app.get('/api/participants', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM participants ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET - Traitement analytique des indicateurs (Stats globales)
app.get('/api/stats', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN scanned = TRUE THEN 1 ELSE 0 END) as scanned,
                SUM(CASE WHEN ticket_generated = TRUE THEN 1 ELSE 0 END) as ticketsgenerated
            FROM participants
        `);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST - Insertion unitaire manuelle d'un inscrit
app.post('/api/participants', async (req, res) => {
    const { nomPrénom, dateNaissance, lieuNaissance, age, égliseProvenance, numéroTéléphone } = req.body;
    
    if (!nomPrénom) {
        res.status(400).json({ error: 'Le nom et prénom sont obligatoires' });
        return;
    }
    
    try {
        const existing = await pool.query('SELECT id FROM participants WHERE nom_prenom = $1', [nomPrénom]);
        if (existing.rows.length > 0) {
            res.status(409).json({ error: 'Doublon', message: `Le participant "${nomPrénom}" existe déjà` });
            return;
        }
        
        // Structure de hachage du QR Code unique lié à la transaction temporelle
        const qrCode = `TICKET_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const result = await pool.query(
            `INSERT INTO participants (nom_prenom, date_naissance, lieu_naissance, age, eglise_provenance, numero_telephone, qr_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [nomPrénom, dateNaissance || '', lieuNaissance || '', age || null, égliseProvenance || '', numéroTéléphone || '', qrCode]
        );
        
        res.json({ id: result.rows[0].id, qrCode, success: true });
        broadcastParticipants();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST - Import massif de données (Batch de lignes CSV)
app.post('/api/participants/batch', async (req, res) => {
    const participantsList = req.body;
    
    if (!participantsList || !Array.isArray(participantsList) || participantsList.length === 0) {
        res.status(400).json({ error: 'Aucun participant à ajouter' });
        return;
    }
    
    let successCount = 0;
    let duplicates = [];

    for (const p of participantsList) {
        const targetNom = p.nomPrénom || p.nom_prenom;
        
        // SÉCURITÉ : Validation de type pour éliminer les corruptions et sauter les lignes invalides
        if (!targetNom || typeof targetNom !== 'string') {
            continue; 
        }

        const qrCode = `TICKET_${Date.now()}_${Math.random().toString(36).substr(2, 8)}_${targetNom.replace(/\s/g, '')}`;
        try {
            const result = await pool.query(
                `INSERT INTO participants (nom_prenom, date_naissance, lieu_naissance, age, eglise_provenance, numero_telephone, qr_code)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (qr_code) DO NOTHING`,
                [
                    targetNom, 
                    p.dateNaissance || p.date_naissance || '', 
                    p.lieuNaissance || p.lieu_naissance || '', 
                    p.age ? parseInt(p.age, 10) : null, 
                    p.égliseProvenance || p.eglise_provenance || '', 
                    p.numéroTéléphone || p.numero_telephone || ''
                ]
            );
            if (result.rowCount > 0) {
                successCount++;
            } else {
                duplicates.push(targetNom);
            }
        } catch (err) {
            if (err.code === '23505') {
                duplicates.push(targetNom);
            } else {
                console.error('Erreur ligne batch participant:', err.message);
            }
        }
    }
    
    res.json({ success: true, count: successCount, duplicates });
    broadcastParticipants();
});

// PUT - Validation d'accès à l'événement par scan de badge
app.put('/api/participants/:id/scan', async (req, res) => {
    const { id } = req.params;
    
    try {
        const result = await pool.query('SELECT scanned, nom_prenom FROM participants WHERE id = $1', [id]);
        const row = result.rows[0];

        if (!row) {
            res.status(404).json({ error: 'Participant non trouvé' });
            return;
        }
        
        if (row.scanned) {
            res.json({ success: true, alreadyScanned: true, message: `${row.nom_prenom} a déjà été scanné` });
            return;
        }
        
        await pool.query('UPDATE participants SET scanned = TRUE WHERE id = $1', [id]);
        res.json({ success: true, alreadyScanned: false, message: `${row.nom_prenom} a été validé` });
        broadcastParticipants();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT - Basculer le flag d'état d'affichage/téléchargement du ticket
app.put('/api/participants/:id/generate', async (req, res) => {
    const { id } = req.params;
    
    try {
        await pool.query('UPDATE participants SET ticket_generated = TRUE WHERE id = $1', [id]);
        res.json({ success: true });
        broadcastParticipants();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET - Recherche par concordance exacte de chaîne QR Code
app.get('/api/participants/qr/:qrCode', async (req, res) => {
    const { qrCode } = req.params;
    
    try {
        const result = await pool.query(
            'SELECT id, nom_prenom, date_naissance, eglise_provenance, scanned FROM participants WHERE qr_code = $1',
            [qrCode]
        );
        const row = result.rows[0];

        if (!row) {
            res.status(404).json({ error: 'QR Code non reconnu' });
            return;
        }
        
        res.json(row);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE - Purge unitaire d'un participant
app.delete('/api/participants/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        await pool.query('DELETE FROM participants WHERE id = $1', [id]);
        res.json({ success: true });
        broadcastParticipants();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE - Purge complète de la table
app.delete('/api/participants', async (req, res) => {
    try {
        await pool.query('DELETE FROM participants');
        res.json({ success: true });
        broadcastParticipants();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DÉMARRAGE ET ÉCOUTE DU SERVEUR
// ============================================================
server.listen(PORT, () => {
    console.log(`
    ┌─────────────────────────────────────────────────────┐
    │   🚀 SERVEUR DÉMARRÉ AVEC SUCCÈS !                  │
    ├─────────────────────────────────────────────────────┤
    │   📡 API: http://localhost:${PORT}/api               │
    │   🌐 Frontend origin allowed: ${FRONTEND_ORIGIN}    │
    │   📁 Base de données: PostgreSQL                    │
    └─────────────────────────────────────────────────────┘
    `);
});