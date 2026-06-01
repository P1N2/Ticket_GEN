// ═══════════════════════════════════════════════
// CONFIG & STATE
// ═══════════════════════════════════════════════
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'UJEEBN2026';
const API_BASE_URL = 'https://ticket-gen-xjjy.onrender.com';

let participants = [];
let currentFilter = 'all';
let currentTicketParticipant = null;
let html5QrCode = null;
let pendingCSVData = [];
let scanHistory = [];
let deferredInstallPrompt = null;
let useLocalStorage = false;
let socket = null;

// Helper global pour querySelector
const qs = (selector) => document.querySelector(selector);

// ═══════════════════════════════════════════════
// MAPPER DE SÉCURITÉ (PostgreSQL -> Frontend)
// ═══════════════════════════════════════════════
function mapParticipantData(p) {
  return {
    id: p.id,
    nomPrénom: p.nom_prenom || p.nomPrénom || '',
    dateNaissance: p.date_naissance || p.dateNaissance || '',
    lieuNaissance: p.lieu_naissance || p.lieuNaissance || '',
    age: p.age || null,
    égliseProvenance: p.eglise_provenance || p.égliseProvenance || '',
    numéroTéléphone: p.numero_telephone || p.numéroTéléphone || '',
    qrCode: p.qr_code || p.qrCode || '',
    scanned: p.scanned === true || p.scanned === 'true',
    ticketGenerated: p.ticket_generated === true || p.ticket_generated === 'true' || p.ticketGenerated === true
  };
}

// Fetch API Helper
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const config = { ...options, headers };
  
  const res = await fetch(`${API_BASE_URL}${path}`, config);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API erreur ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

// Chargement initial des données
async function loadParticipants() {
  try {
    const data = await apiFetch('/api/participants');
    participants = Array.isArray(data) ? data.map(mapParticipantData) : [];
    useLocalStorage = false;
    renderParticipants();
    updateDashboard();
  } catch (err) {
    console.warn('Backend inaccessible, bascule LocalStorage', err);
    const raw = localStorage.getItem('ujeebn_participants');
    participants = raw ? JSON.parse(raw) : [];
    useLocalStorage = true;
    renderParticipants();
    updateDashboard();
  }
}

// Gestion de l'authentification
function checkAuth() {
  if (sessionStorage.getItem('ujeebn_auth') === 'true') {
    qs('#auth-page').style.display = 'none';
    qs('#app').style.display = 'flex';
    if (window.innerWidth <= 768) qs('#bottom-nav').style.display = 'flex';
    loadParticipants();
  }
}

function handleLogin() {
  const u = qs('#login-username').value.trim();
  const p = qs('#login-password').value.trim();
  if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) {
    sessionStorage.setItem('ujeebn_auth', 'true');
    checkAuth();
  } else {
    const card = qs('.auth-card');
    card.style.animation = 'shake 0.4s ease';
    setTimeout(() => card.style.animation = '', 400);
    alert('Identifiants incorrects');
  }
}

// Navigation inter-vues
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));

  const targetView = qs(`#view-${viewId}`);
  if (targetView) targetView.classList.add('active');

  const navItem = qs(`.nav-item[data-view="${viewId}"]`);
  if (navItem) navItem.classList.add('active');

  const bnavItem = qs(`.bnav-item[data-view="${viewId}"]`);
  if (bnavItem) bnavItem.classList.add('active');

  qs('#topbar-title').textContent = viewId.charAt(0).toUpperCase() + viewId.slice(1);
  
  if (viewId === 'scanner') {
    setTimeout(initScanner, 100);
  } else {
    stopScanner();
  }
}

// Dashboard et compteurs
function updateDashboard() {
  const total = participants.length;
  const tGenerated = participants.filter(p => p.ticketGenerated).length;
  const scanned = participants.filter(p => p.scanned).length;
  const pending = total - tGenerated;

  qs('#kpi-total').textContent = total;
  qs('#nav-badge-total').textContent = total;
  qs('#kpi-tickets').textContent = tGenerated;
  qs('#kpi-scanned').textContent = scanned;
  qs('#kpi-pending').textContent = pending;

  const tPct = total > 0 ? Math.round((tGenerated / total) * 100) : 0;
  const sPct = total > 0 ? Math.round((scanned / total) * 100) : 0;

  qs('#kpi-tickets-pct').textContent = `${tPct}% des inscrits`;
  qs('#kpi-scanned-pct').textContent = `${sPct}% présents`;

  qs('#progress-label').textContent = `${scanned} / ${total}`;
  qs('#progress-fill').style.width = `${sPct}%`;

  qs('#progress-tickets-label').textContent = `${tGenerated} / ${total}`;
  qs('#progress-tickets-fill').style.width = `${tPct}%`;

  // Rendu des 5 derniers inscrits
  const recentContainer = qs('#recent-participants');
  recentContainer.innerHTML = '';
  const recents = [...participants].slice(0, 5);

  if (recents.length === 0) {
    recentContainer.innerHTML = '<div class="scan-empty">Aucun inscrit pour le moment</div>';
    return;
  }

  recents.forEach(p => {
    const div = document.createElement('div');
    div.className = 'recent-item';
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:0.75rem;">
        <div class="user-avatar" style="width:32px; height:32px; font-size:0.85rem;">${p.nomPrénom.charAt(0)}</div>
        <div>
          <strong style="display:block; color:var(--text-main); font-size:0.9rem;">${p.nomPrénom}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted);">${p.égliseProvenance || 'Non renseignée'}</span>
        </div>
      </div>
      <span class="status-badge ${p.scanned ? 'success' : p.ticketGenerated ? 'warning' : 'neutral'}">
        ${p.scanned ? 'Présent' : p.ticketGenerated ? 'Ticket prêt' : 'En attente'}
      </span>
    `;
    recentContainer.appendChild(div);
  });
}

// Gestion de l'affichage de la table
function renderParticipants() {
  const tbody = qs('#participants-tbody');
  tbody.innerHTML = '';

  const filtered = participants.filter(p => {
    if (currentFilter === 'scanned') return p.scanned;
    if (currentFilter === 'ticket') return p.ticketGenerated && !p.scanned;
    if (currentFilter === 'pending') return !p.ticketGenerated;
    return true;
  });

  const search = qs('#search-input').value.toLowerCase();
  const finalData = filtered.filter(p => 
    p.nomPrénom.toLowerCase().includes(search) || 
    p.égliseProvenance.toLowerCase().includes(search)
  );

  qs('#table-count').textContent = `${finalData.length} participant(s) affiché(s)`;

  if (finalData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:3rem; color:var(--text-muted);">Aucun participant trouvé</td></tr>`;
    return;
  }

  finalData.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td><strong>${p.nomPrénom}</strong><div style="font-size:0.75rem; color:var(--text-muted);">${p.numéroTéléphone || '—'}</div></td>
      <td>${p.égliseProvenance || '—'}</td>
      <td>${p.dateNaissance || '—'}</td>
      <td>
        <span class="status-badge ${p.scanned ? 'success' : p.ticketGenerated ? 'warning' : 'neutral'}">
          ${p.scanned ? 'Scanné' : p.ticketGenerated ? 'Ticket prêt' : 'En attente'}
        </span>
      </td>
      <td>
        <div style="display:flex; gap:0.5rem;">
          <button class="action-btn btn-view-ticket" data-id="${p.id}" title="Voir le Ticket">
            <span class="material-icons-round">confirmation_number</span>
          </button>
          <button class="action-btn btn-del-p btn-danger" data-id="${p.id}" title="Supprimer">
            <span class="material-icons-round">delete</span>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Liaison des actions sur la table
  document.querySelectorAll('.btn-view-ticket').forEach(b => b.addEventListener('click', e => {
    const id = e.currentTarget.getAttribute('data-id');
    showTicketModal(id);
  }));

  document.querySelectorAll('.btn-del-p').forEach(b => b.addEventListener('click', async (e) => {
    const id = e.currentTarget.getAttribute('data-id');
    if (confirm('Supprimer ce participant ?')) {
      try {
        await apiFetch(`/api/participants/${id}`, { method: 'DELETE' });
      } catch {
        participants = participants.filter(p => p.id != id);
        localStorage.setItem('ujeebn_participants', JSON.stringify(participants));
        renderParticipants(); updateDashboard();
      }
    }
  }));

  renderTicketsGrid();
}

// Création visuelle du Ticket + QR Code
function generateTicketHTML(p) {
  return `
    <div class="ticket-card-export" id="ticket-card-render-${p.id}">
      <div class="ticket-export-header">
        <div class="ticket-logo-box">U</div>
        <div>
          <div class="ticket-title-main">UJEEBN NIGER</div>
          <div class="ticket-subtitle-main">Camp Biblique National 2026</div>
        </div>
      </div>
      <div class="ticket-export-body">
        <div class="ticket-export-info">
          <div class="ticket-info-field"><label>PARTICIPANT</label><span class="val-nom">${p.nomPrénom}</span></div>
          <div class="ticket-info-field"><label>ÉGLISE DE PROVENANCE</label><span>${p.égliseProvenance || 'Non renseignée'}</span></div>
          <div class="ticket-info-field"><label>DATE DE NAISSANCE</label><span>${p.dateNaissance || 'Non renseignée'}</span></div>
          <div class="ticket-info-field-row">
            <div><label>N° TÉLÉPHONE</label><span>${p.numéroTéléphone || '—'}</span></div>
            <div><label>STATUT</label><span style="color:var(--accent-color); font-weight:700;">ACCÈS ADMIN</span></div>
          </div>
        </div>
        <div class="ticket-export-qrcode">
          <div id="canvas-qrcode-${p.id}" class="qrcode-zone-render"></div>
          <div class="ticket-code-str">${p.qrCode}</div>
        </div>
      </div>
      <div class="ticket-export-footer">🎯 Lieu : Dosso · Dates : 02 au 07 Août 2026 · Présentez ce QR Code à l'entrée.</div>
    </div>
  `;
}

// Déclenchement du dessin du QR code via la librairie cliente
function drawQRCodeElement(id, text) {
  const container = document.getElementById(`canvas-qrcode-${id}`);
  if (container) {
    container.innerHTML = '';
    new QRCode(container, {
      text: text,
      width: 110,
      height: 110,
      colorDark: "#ffffff",
      colorLight: "#141414",
      correctLevel: QRCode.CorrectLevel.H
    });
  }
}

function showTicketModal(id) {
  const p = participants.find(part => part.id == id);
  if (!p) return;
  currentTicketParticipant = p;

  const container = qs('#ticket-to-export');
  container.innerHTML = generateTicketHTML(p);
  drawQRCodeElement(p.id, p.qrCode);

  qs('#ticket-modal').classList.add('active');

  // Envoi asynchrone au backend pour notifier la génération
  if (!p.ticketGenerated && !useLocalStorage) {
    apiFetch(`/api/participants/${p.id}/generate`, { method: 'PUT' }).catch(console.error);
  }
}

function renderTicketsGrid() {
  const grid = qs('#tickets-grid');
  grid.innerHTML = '';

  if (participants.length === 0) {
    grid.innerHTML = '<div class="scan-empty" style="grid-column:1/-1;">Aucun ticket disponible.</div>';
    return;
  }

  participants.forEach(p => {
    const box = document.createElement('div');
    box.className = 'ticket-item-container';
    box.innerHTML = generateTicketHTML(p);
    grid.appendChild(box);
    drawQRCodeElement(p.id, p.qrCode);
  });
}

// Saisie Manuelle de participant
async function addManualParticipant() {
  const nom = qs('#manual-nom').value.trim();
  const date = qs('#manual-date').value.trim();
  const eglise = qs('#manual-eglise').value.trim();
  const tel = qs('#manual-numero').value.trim();

  if (!nom) { alert('Le nom est obligatoire'); return; }

  const bodyData = { nomPrénom: nom, dateNaissance: date, égliseProvenance: eglise, numéroTéléphone: tel };

  try {
    await apiFetch('/api/participants', { method: 'POST', body: JSON.stringify(bodyData) });
    qs('#manual-nom').value = ''; qs('#manual-date').value = ''; qs('#manual-eglise').value = ''; qs('#manual-numero').value = '';
    switchView('participants');
  } catch {
    const localId = Date.now();
    const newP = { id: localId, ...bodyData, qrCode: `LOCAL_${localId}`, scanned: false, ticketGenerated: true };
    participants.unshift(newP);
    localStorage.setItem('ujeebn_participants', JSON.stringify(participants));
    renderParticipants(); updateDashboard();
    switchView('participants');
  }
}

// Traitement du CSV
function handleCSVFile(file) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.split('\n');
    pendingCSVData = [];

    lines.forEach((line, index) => {
      if (index === 0 || !line.trim()) return; // Ignore l'en-tête ou les vides
      const cols = line.split(/,|;/); // Découpage dynamique virgule / point-virgule
      if (cols.length >= 2 && cols[1].trim()) {
        pendingCSVData.push({
          nomPrénom: cols[1].replace(/"/g, '').trim(),
          dateNaissance: cols[2] ? cols[2].replace(/"/g, '').trim() : '',
          égliseProvenance: cols[4] ? cols[4].replace(/"/g, '').trim() : '',
          numéroTéléphone: cols[5] ? cols[5].replace(/"/g, '').trim() : ''
        });
      }
    });

    const tbody = qs('#preview-tbody');
    tbody.innerHTML = '';
    qs('#preview-count-label').textContent = `${pendingCSVData.length} participants détectés`;

    pendingCSVData.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${p.nomPrénom}</td><td>${p.dateNaissance}</td><td>${p.égliseProvenance}</td><td><span class="status-badge neutral">Prêt</span></td>`;
      tbody.appendChild(tr);
    });

    qs('#csv-preview-section').style.display = 'block';
  };
  reader.readAsText(file, 'UTF-8');
}

async function confirmImport() {
  if (pendingCSVData.length === 0) return;
  try {
    await apiFetch('/api/participants/batch', { method: 'POST', body: JSON.stringify(pendingCSVData) });
    alert('Importation cloud validée !');
  } catch (err) {
    console.error(err);
    alert('Erreur réseau, bascule locale.');
    pendingCSVData.forEach(p => {
      const id = Math.random();
      participants.push({ id, ...p, qrCode: `LOCAL_${Date.now()}_${id}`, scanned: false, ticketGenerated: true });
    });
    localStorage.setItem('ujeebn_participants', JSON.stringify(participants));
    renderParticipants(); updateDashboard();
  }
  qs('#csv-preview-section').style.display = 'none';
  switchView('participants');
}

// Scanner Logique (html5-qrcode)
function initScanner() {
  if (html5QrCode) return;
  html5QrCode = new Html5Qrcode("qr-reader");
  qs('#start-scan-btn').style.display = 'inline-flex';
  qs('#stop-scan-btn').style.display = 'none';
}

function startScanner() {
  if (!html5QrCode) return;
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    onScanSuccess
  ).then(() => {
    qs('#start-scan-btn').style.display = 'none';
    qs('#stop-scan-btn').style.display = 'inline-flex';
  }).catch(console.error);
}

function stopScanner() {
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop().then(() => {
      html5QrCode = null;
      initScanner();
    }).catch(console.error);
  }
}

async function onScanSuccess(decodedText) {
  stopScanner();
  try {
    const p = await apiFetch(`/api/participants/qr/${decodedText}`);
    const localMatch = participants.find(part => part.id == p.id);
    
    if (p.scanned || (localMatch && localMatch.scanned)) {
      showScanResult(false, 'Déjà Scanné', `${p.nom_prenom || p.nomPrénom} a déjà validé son entrée.`);
    } else {
      await apiFetch(`/api/participants/${p.id}/scan`, { method: 'PUT' });
      showScanResult(true, 'Validé', `Entrée confirmée pour ${p.nom_prenom || p.nomPrénom}.`);
      addScanHistory(p.nom_prenom || p.nomPrénom, true);
    }
  } catch (err) {
    showScanResult(false, 'Inconnu', 'QR Code invalide ou serveur injoignable.');
  }
}

function showScanResult(success, title, msg) {
  const modal = qs('#scan-modal');
  const wrap = qs('#scan-icon-wrap');
  const icon = qs('#scan-result-icon');

  wrap.className = `scan-result-icon ${success ? 'success' : 'danger'}`;
  icon.textContent = success ? 'check_circle' : 'cancel';
  qs('#scan-result-title').textContent = title;
  qs('#scan-result-message').textContent = msg;

  modal.classList.add('active');
}

function addScanHistory(name, success) {
  const container = qs('#scan-history');
  if (qs('.scan-empty')) container.innerHTML = '';

  const div = document.createElement('div');
  div.className = 'history-item';
  div.innerHTML = `
    <div style="display:flex; align-items:center; gap:0.5rem;">
      <span class="material-icons-round" style="color:${success ? 'var(--success-color)' : 'var(--danger-color)'}">
        ${success ? 'check_circle' : 'cancel'}
      </span>
      <span>${name}</span>
    </div>
    <span style="font-size:0.75rem; color:var(--text-muted);">${new Date().toLocaleTimeString()}</span>
  `;
  container.unshift(div);
}

// Real-Time Sync (Socket.IO client)
function initSocket() {
  socket = io(API_BASE_URL);
  socket.on('connect', () => console.log('⚡ Connecté au serveur Socket.IO cloud !'));
  
  socket.on('participants:changed', (data) => {
    console.log('🔄 Données temps réel synchronisées');
    participants = Array.isArray(data) ? data.map(mapParticipantData) : [];
    renderParticipants();
    updateDashboard();
  });
}

// ============================================================
// INITIALISATION DES ÉCOUTEURS D'ÉVÉNEMENTS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  initSocket();

  qs('#login-btn').addEventListener('click', handleLogin);
  qs('#logout-btn').addEventListener('click', () => {
    sessionStorage.clear();
    window.location.reload();
  });

  // Navigation Bureau et Mobile PWA
  document.querySelectorAll('.nav-item, .bnav-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const view = e.currentTarget.getAttribute('data-view');
      switchView(view);
    });
  });

  qs('#search-input').addEventListener('input', renderParticipants);

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.getAttribute('data-filter');
      renderParticipants();
    });
  });

  // Actions d'importation CSV
  const fileInput = qs('#csv-file');
  qs('#csv-upload-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => e.target.files[0] && handleCSVFile(e.target.files[0]));

  qs('#confirm-import-btn').addEventListener('click', confirmImport);
  qs('#cancel-import-btn').addEventListener('click', () => {
    qs('#csv-preview-section').style.display = 'none';
    fileInput.value = '';
  });

  qs('#save-manual-btn').addEventListener('click', addManualParticipant);

  // Modals close triggers
  qs('#close-ticket-modal').addEventListener('click', () => qs('#ticket-modal').classList.remove('active'));
  qs('#close-ticket-footer').addEventListener('click', () => qs('#ticket-modal').classList.remove('active'));
  qs('#close-scan-modal').addEventListener('click', () => {
    qs('#scan-modal').classList.remove('active');
    startScanner();
  });

  // Scanner actions
  qs('#start-scan-btn').addEventListener('click', startScanner);
  qs('#stop-scan-btn').addEventListener('click', stopScanner);

  // Tout supprimer
  qs('#delete-all-btn').addEventListener('click', async () => {
    if (confirm('ATTENTION : Voulez-vous vider entièrement la base de données ?')) {
      try {
        await apiFetch('/api/participants', { method: 'DELETE' });
      } catch {
        participants = []; localStorage.removeItem('ujeebn_participants');
        renderParticipants(); updateDashboard();
      }
    }
  });

  // Export PNG du ticket
  qs('#download-ticket-btn').addEventListener('click', () => {
    const target = qs(`#ticket-card-render-${currentTicketParticipant.id}`);
    html2canvas(target, { backgroundColor: '#141414', scale: 2 }).then(canvas => {
      const link = document.createElement('a');
      link.download = `Ticket_${currentTicketParticipant.nomPrénom.replace(/\s/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    });
  });
});