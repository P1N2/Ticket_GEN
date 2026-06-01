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

// ═══════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API erreur ${res.status}: ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function loadParticipants() {
  try {
    const data = await apiFetch('/api/participants');
    participants = Array.isArray(data) ? data : [];
    useLocalStorage = false;
  } catch (err) {
    console.warn('Backend inaccessible, utilisation du stockage local', err);
    const raw = localStorage.getItem('ujeebn_participants');
    if (raw) {
      participants = JSON.parse(raw);
    } else {
      participants = [
        { id: 1, nom: 'Jean Dupont', dateNaissance: '15/03/2000 à Niamey', eglise: 'Baptiste de Niamey', numero: '90123456', scanned: false, ticketGenerated: true },
        { id: 2, nom: 'Marie Coulibaly', dateNaissance: '22/07/1998 à Dosso', eglise: 'Assemblées de Dieu', numero: '98765432', scanned: true, ticketGenerated: true },
        { id: 3, nom: 'Amadou Issaka', dateNaissance: '10/12/2001 à Zinder', eglise: 'Évangélique de Zinder', numero: '91234567', scanned: false, ticketGenerated: true },
        { id: 4, nom: 'Fatima Zakari', dateNaissance: '05/05/1999 à Maradi', eglise: 'Cathédrale Saint-Jean', numero: '92345678', scanned: false, ticketGenerated: true }
      ];
      localStorage.setItem('ujeebn_participants', JSON.stringify(participants));
    }
    useLocalStorage = true;
  }
  refreshAll();
}

// Socket.IO real-time sync
let socket = null;
function initSocket() {
  try {
    const script = document.createElement('script');
    const src = (API_BASE_URL ? API_BASE_URL : '') + '/socket.io/socket.io.js';
    script.src = src;
    script.onload = () => {
      try {
        socket = io(API_BASE_URL || undefined);
        socket.on('participants:changed', data => {
          participants = Array.isArray(data) ? data : participants;
          useLocalStorage = false;
          refreshAll();
        });
      } catch (e) { console.warn('Socket init failed', e); }
    };
    script.onerror = () => { console.warn('Impossible de charger le client Socket.IO', src); };
    document.head.appendChild(script);
  } catch (err) { console.warn('Socket setup error', err); }
}

function saveParticipants() {
  if (useLocalStorage) {
    localStorage.setItem('ujeebn_participants', JSON.stringify(participants));
  }
  refreshAll();
}

// ═══════════════════════════════════════════════
// HELPER FUNCTIONS FROM CODE
// ═══════════════════════════════════════════════
function getNextId() {
  return participants.length > 0 ? Math.max(...participants.map(p => p.id)) + 1 : 1;
}
function closeTicketModal() {
  qs('#ticket-modal').classList.remove('active');
  currentTicketParticipant = null;
}

// ═══════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════
function login() {
  const u = qs('#login-username').value.trim();
  const p = qs('#login-password').value;
  if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) {
    sessionStorage.setItem('ujeebn_auth', '1');
    showApp();
  } else {
    shake(qs('.auth-card'));
    qs('#login-password').value = '';
  }
}

function logout() {
  sessionStorage.removeItem('ujeebn_auth');
  qs('#app').style.display = 'none';
  qs('#auth-page').style.display = 'flex';
  qs('#login-username').value = '';
  qs('#login-password').value = '';
  stopScanner();
}

async function showApp() {
  qs('#auth-page').style.display = 'none';
  qs('#app').style.display = 'flex';
  await loadParticipants();
  switchView('dashboard');
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake .4s ease';
}

// ═══════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════
const VIEW_TITLES = {
  dashboard: 'Dashboard',
  participants: 'Participants',
  tickets: 'Tickets',
  import: 'Importer',
  scanner: 'Scanner QR'
};

function switchView(name) {
  qsa('.view').forEach(v => v.classList.remove('active'));
  const target = qs(`#view-${name}`);
  if (target) target.classList.add('active');

  qsa('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });

  qsa('.bnav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });

  qs('#topbar-title').textContent = VIEW_TITLES[name] || name;

  if (name === 'participants') renderParticipantsTable();
  if (name === 'tickets') renderTicketsGrid();
  if (name === 'dashboard') renderDashboard();
  if (name !== 'scanner') stopScanner();

  closeSidebar();
}

// ═══════════════════════════════════════════════
// STATS & DASHBOARD
// ═══════════════════════════════════════════════
function refreshAll() {
  const total = participants.length;
  const scanned = participants.filter(p => p.scanned).length;

  setText('#kpi-total', total);
  setText('#kpi-tickets', total);
  setText('#kpi-scanned', scanned);
  setText('#nav-badge-total', total);

  const sPct = total ? Math.round(scanned / total * 100) : 0;

  setText('#kpi-tickets-pct', `100% des inscrits`);
  setText('#kpi-scanned-pct', `${sPct}% présents`);

  setText('#progress-label', `${scanned} / ${total}`);
  setText('#progress-tickets-label', `${total} / ${total}`);

  qs('#progress-fill').style.width = `${sPct}%`;
  qs('#progress-tickets-fill').style.width = `100%`;

  renderRecentParticipants();
}

function renderDashboard() { refreshAll(); }

function renderRecentParticipants() {
  const el = qs('#recent-participants');
  const recent = [...participants].slice(-5).reverse();
  if (recent.length === 0) {
    el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text3)">Aucun participant</div>';
    return;
  }
  el.innerHTML = recent.map(p => `
    <div class="recent-item">
      <div class="recent-avatar">${p.nom.charAt(0).toUpperCase()}</div>
      <div>
        <div class="recent-name">${esc(p.nom)}</div>
        <div class="recent-church">${esc(p.eglise || '—')}</div>
      </div>
      <span class="recent-status ${p.scanned ? 'status-scanned' : 'status-ready'}">
        ${p.scanned ? '✓ Scanné' : '🎫 Ticket'}
      </span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════
// PARTICIPANTS TABLE
// ═══════════════════════════════════════════════
function renderParticipantsTable() {
  const searchTerm = (qs('#search-input')?.value || '').toLowerCase();
  let list = participants;

  if (searchTerm) {
    list = list.filter(p =>
      p.nom.toLowerCase().includes(searchTerm) ||
      (p.eglise || '').toLowerCase().includes(searchTerm)
    );
  }

  if (currentFilter === 'scanned') list = list.filter(p => p.scanned);
  else if (currentFilter === 'ticket') list = list.filter(p => !p.scanned);
  else if (currentFilter === 'pending') list = [];

  setText('#table-count', `${list.length} participant(s)`);

  const tbody = qs('#participants-tbody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3)">Aucun résultat</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td class="td-name">${esc(p.nom)}</td>
      <td>${esc(p.eglise || '—')}</td>
      <td>${esc(p.dateNaissance || '—')}</td>
      <td>
        <span class="recent-status ${p.scanned ? 'status-scanned' : 'status-ready'}">
          ${p.scanned ? '✓ Scanné' : '🎫 Prêt'}
        </span>
      </td>
      <td>
        <div class="td-actions">
          <button class="btn-action" title="Voir ticket" onclick="openTicketModal(${p.id})">
            <span class="material-icons-round">qr_code</span>
          </button>
          <button class="btn-action danger" title="Supprimer" onclick="deleteParticipant(${p.id})">
            <span class="material-icons-round">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function deleteParticipant(id) {
  if (!confirm('Supprimer ce participant ?')) return;
  if (!useLocalStorage) {
    try {
      await apiFetch(`/api/participants/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error(err);
      return alert('Erreur lors de la suppression.');
    }
  }
  participants = participants.filter(p => p.id !== id);
  saveParticipants();
  renderParticipantsTable();
}

async function deleteAll() {
  if (!confirm('⚠️ Supprimer TOUS les participants ? Action irréversible.')) return;
  if (!useLocalStorage) {
    try {
      await apiFetch('/api/participants', { method: 'DELETE' });
    } catch (err) {
      console.error(err);
      return alert('Erreur lors de la suppression de tous les participants.');
    }
  }
  participants = [];
  saveParticipants();
  renderParticipantsTable();
}

async function generateAllTickets() {
  alert('Tous les tickets de vos participants actifs sont valides et disponibles !');
}

// ═══════════════════════════════════════════════
// TICKETS GRID
// ═══════════════════════════════════════════════
function renderTicketsGrid() {
  const grid = qs('#tickets-grid');
  if (participants.length === 0) {
    grid.innerHTML = '<div style="color:var(--text3);padding:2rem;">Aucun participant inscrit.</div>';
    return;
  }
  grid.innerHTML = participants.map(p => `
    <div class="ticket-card-mini">
      <div class="ticket-mini-header">
        <div class="ticket-mini-avatar">${p.nom.charAt(0)}</div>
        <div>
          <div class="ticket-mini-name">${esc(p.nom)}</div>
          <div class="ticket-mini-church">${esc(p.eglise || '—')}</div>
        </div>
      </div>
      <span class="ticket-mini-status ${p.scanned ? 'status-scanned' : 'status-ready'}">
        ${p.scanned ? '✓ Scanné' : '🎫 Ticket généré'}
      </span>
      <div class="ticket-mini-actions">
        <button class="btn-ticket-action btn-ticket-view" onclick="openTicketModal(${p.id})">
          <span class="material-icons-round">visibility</span> Voir ticket
        </button>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════
// TICKET MODAL
// ═══════════════════════════════════════════════
async function openTicketModal(id) {
  const p = participants.find(x => x.id === id);
  if (!p) return;
  currentTicketParticipant = p;

  const qrData = JSON.stringify({ id: p.id, nom: p.nom });
  
  const parts = p.nom.trim().split(' ');
  const initials = parts.length > 1 
    ? (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase() 
    : p.nom.slice(0, 2).toUpperCase();

  qs('#ticket-to-export').innerHTML = buildTicketHTML(p, initials);

  setTimeout(() => {
    const container = document.getElementById('ticket-qr-code');
    if (container) {
      container.innerHTML = '';
      new QRCode(container, {
        text: qrData,
        width: 140,
        height: 140,
        colorDark: "#111111",
        colorLight: "#F6C90E",
        correctLevel: QRCode.CorrectLevel.H
      });
    }
  }, 80);

  qs('#ticket-modal').classList.add('active');
}

function buildTicketHTML(p, initials) {
  return `
  <div id="ticket-inner" style="
    width: 650px;
    height: 280px;
    background: #ffffff;
    border-radius: 20px;
    overflow: hidden;
    font-family: 'DM Sans', Arial, sans-serif;
    box-shadow: 0 20px 50px rgba(0,0,0,.15);
    margin: 0 auto;
    display: flex;
    text-align: left;
    position: relative;
  ">
    <div style="
      flex: 1;
      padding: 24px 28px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    ">
      <div>
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
          <div style="font-family:'Syne',Arial,sans-serif; font-size:.68rem; font-weight:800; letter-spacing:.12em; color:#aaa; text-transform:uppercase;">Camp Biblique UJEEBN · 2026</div>
          <span style="font-size: .65rem; background: #f5f5f5; padding: 3px 8px; border-radius: 6px; font-weight: 600; color: #666;">36e Édition</span>
        </div>
        
        <div style="font-family:'Syne',Arial,sans-serif; font-size:1.6rem; font-weight:800; color:#111; line-height:1.2; max-height:76px; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; margin-bottom:16px;">
          ${esc(p.nom)}
        </div>

        <div style="display: flex; gap: 24px;">
          <div>
            <div style="font-size:.62rem; color:#aaa; text-transform:uppercase; letter-spacing:.06em; font-weight:600; margin-bottom:2px;">Date de Naissance</div>
            <div style="font-size:.85rem; color:#111; font-weight:600;">${esc(p.dateNaissance || '—')}</div>
          </div>
          <div>
            <div style="font-size:.62rem; color:#aaa; text-transform:uppercase; letter-spacing:.06em; font-weight:600; margin-bottom:2px;">Église de provenance</div>
            <div style="font-size:.85rem; color:#111; font-weight:600;">${esc(p.eglise || '—')}</div>
          </div>
        </div>
      </div>

      <div style="font-size: .72rem; color: #888; font-style: italic; border-top: 1px solid #f0f0f0; padding-top: 10px; font-weight: 500;">
        "Vous êtes la lumière du monde" — Mt 5:14
      </div>
    </div>

    <div style="
      width: 0px;
      border-left: 2px dashed #111111;
      position: relative;
      z-index: 10;
    ">
      <div style="position: absolute; top: -10px; left: -10px; width: 18px; height: 18px; background: rgba(0,0,0,0.85); border-radius: 50%;"></div>
      <div style="position: absolute; bottom: -10px; left: -10px; width: 18px; height: 18px; background: rgba(0,0,0,0.85); border-radius: 50%;"></div>
    </div>

    <div style="
      width: 210px;
      background: #F6C90E;
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    ">
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; margin-bottom: 6px;">
        <div style="font-family:'Syne',Arial,sans-serif; font-size:1.1rem; font-weight:900; color:#111;">#${String(p.id).padStart(4, '0')}</div>
        <div style="
          width:34px; height:34px;
          background:#111;
          border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          font-family:'Syne',Arial,sans-serif;
          font-size:0.85rem; font-weight:900;
          color:#F6C90E;
        ">${initials}</div>
      </div>

      <div style="
        padding: 8px;
        background: #F6C90E;
        border: 2px solid #111;
        border-radius: 12px;
        line-height: 0;
      ">
        <div id="ticket-qr-code" style="width:140px; height:140px;"></div>
      </div>

      <div style="font-family:'Syne',Arial,sans-serif; font-size:0.62rem; font-weight:700; color:#111; text-transform:uppercase; letter-spacing:0.04em; text-align:center;">
        Dosso · 02-07 Août 2026
      </div>
    </div>
  </div>
  `;
}

function downloadTicket() {
  const target = qs('#ticket-inner');
  if (!target || !currentTicketParticipant) return;

  html2canvas(target, {
    backgroundColor: null,
    scale: 2,
    logging: false,
    useCORS: true
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = `Ticket_${currentTicketParticipant.nom.replace(/\s/g, '_')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

function showScanResult(type, title, msg) {
  const iconMap = { ok: 'check_circle', warn: 'warning', error: 'cancel' };
  const colorMap = { ok: 'var(--green)', warn: 'var(--accent)', error: 'var(--red)' };
  const bgMap = { ok: 'rgba(34,197,94,.15)', warn: 'rgba(246,201,14,.15)', error: 'rgba(239,68,68,.15)' };

  const wrap = qs('#scan-icon-wrap');
  const icon = qs('#scan-result-icon');
  wrap.style.background = bgMap[type];
  icon.textContent = iconMap[type];
  icon.style.color = colorMap[type];
  setText('#scan-result-title', title);
  setText('#scan-result-message', msg);
  qs('#scan-modal').classList.add('active');
}

function closeScanModal() {
  qs('#scan-modal').classList.remove('active');
}

// ═══════════════════════════════════════════════
// IMPORT CSV
// ═══════════════════════════════════════════════
function handleCSVFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n');
    pendingCSVData = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = parseCSVLine(lines[i]);
      const nom = clean(vals[1]);
      if (!nom) continue;
      pendingCSVData.push({
        nom,
        dateNaissance: clean(vals[2]),
        eglise: clean(vals[4]),
        numero: clean(vals[5]),
        isDuplicate: !!participants.find(p => p.nom.toLowerCase() === nom.toLowerCase())
      });
    }
    showCSVPreview();
  };
  reader.readAsText(file, 'UTF-8');
}

function parseCSVLine(line) {
  const result = []; let current = ''; let inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(current); current = ''; }
    else { current += c; }
  }
  result.push(current);
  return result;
}

function clean(v) { return v ? v.replace(/^"|"$/g, '').trim() : ''; }

// ═══════════════════════════════════════════════
// ADD MANUAL
// ═══════════════════════════════════════════════
function showCSVPreview() {
  const newCount = pendingCSVData.filter(p => !p.isDuplicate).length;
  const dupCount = pendingCSVData.filter(p => p.isDuplicate).length;

  setText('#preview-count-label', `Aperçu : ${newCount} nouveaux, ${dupCount} doublons`);

  qs('#preview-tbody').innerHTML = pendingCSVData.map(p => `
    <tr style="${p.isDuplicate ? 'opacity:.5' : ''}">
      <td>${esc(p.nom)}</td>
      <td>${esc(p.dateNaissance)}</td>
      <td>${esc(p.eglise)}</td>
      <td>
        <span class="recent-status ${p.isDuplicate ? 'status-pending' : 'status-ready'}">
          ${p.isDuplicate ? '⚠️ Doublon' : '✅ Nouveau'}
        </span>
      </td>
    </tr>
  `).join('');

  qs('#csv-preview-section').style.display = 'block';
}

async function confirmImport() {
  const toAdd = pendingCSVData.filter(p => !p.isDuplicate);
  if (toAdd.length === 0) return alert('Aucun nouveau participant à importer');

  const preparedData = toAdd.map(p => ({ ...p, ticketGenerated: true }));

  if (!useLocalStorage) {
    try {
      await apiFetch('/api/participants/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preparedData)
      });
      await loadParticipants();
    } catch (err) {
      console.error(err);
      return alert('Erreur lors de l’import CSV.');
    }
  } else {
    preparedData.forEach(p => {
      participants.push({
        id: getNextId(),
        nom: p.nom,
        dateNaissance: p.dateNaissance,
        eglise: p.eglise,
        numero: p.numero,
        scanned: false,
        ticketGenerated: true
      });
    });
    saveParticipants();
  }

  cancelImport();
  switchView('participants');
  alert(`✅ ${toAdd.length} participants importés avec succès !`);
}

function cancelImport() {
  pendingCSVData = [];
  qs('#csv-preview-section').style.display = 'none';
  qs('#csv-file').value = '';
}

async function addManualParticipant() {
  const nom = qs('#manual-nom').value.trim();
  if (!nom) return alert('❌ Le nom est obligatoire');
  if (participants.find(p => p.nom.toLowerCase() === nom.toLowerCase())) {
    return alert(`⚠️ "${nom}" est déjà inscrit`);
  }

  const payload = {
    nom,
    dateNaissance: qs('#manual-date').value.trim(),
    eglise: qs('#manual-eglise').value.trim(),
    numero: qs('#manual-numero').value.trim(),
    ticketGenerated: true
  };

  if (!useLocalStorage) {
    try {
      const response = await apiFetch('/api/participants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      participants.unshift({
        id: response.id,
        nom,
        dateNaissance: payload.dateNaissance,
        eglise: payload.eglise,
        numero: payload.numero,
        scanned: false,
        ticketGenerated: true
      });
      saveParticipants();
    } catch (err) {
      console.error(err);
      return alert('Erreur lors de l’ajout du participant.');
    }
  } else {
    participants.push({
      id: getNextId(),
      nom,
      dateNaissance: payload.dateNaissance,
      eglise: payload.eglise,
      numero: payload.numero,
      scanned: false,
      ticketGenerated: true
    });
    saveParticipants();
  }

  qs('#manual-nom').value = '';
  qs('#manual-date').value = '';
  qs('#manual-eglise').value = '';
  qs('#manual-numero').value = '';
  switchView('participants');
  alert('✅ Participant ajouté !');
}

// ═══════════════════════════════════════════════
// SIDEBAR TOGGLE (mobile)
// ═══════════════════════════════════════════════
function openSidebar() {
  qs('.sidebar').classList.add('open');
  let overlay = qs('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay active';
    overlay.addEventListener('click', closeSidebar);
    document.body.appendChild(overlay);
  } else {
    overlay.classList.add('active');
  }
}

function closeSidebar() {
  qs('.sidebar').classList.remove('open');
  const overlay = qs('.sidebar-overlay');
  if (overlay) overlay.classList.remove('active');
}

// ═══════════════════════════════════════════════
// NOUVELLES AJOUTS : LOGIQUE DU SCANNER QR CODE
// ═══════════════════════════════════════════════
async function requestCameraAndStart() {
  // CORRECTION : On s'assure d'utiliser le bon sélecteur avec le dièse '#'
  const readerEl = qs('#reader'); 
  if (!readerEl) {
    alert("Erreur: L'élément HTML '#reader' est introuvable. Vérifiez votre fichier HTML.");
    return;
  }

  if (html5QrCode) {
    await stopScanner();
  }

  if (qs('#start-scan-btn')) qs('#start-scan-btn').style.display = 'none';
  if (qs('#stop-scan-btn')) qs('#stop-scan-btn').style.display = 'inline-flex';
  readerEl.style.display = 'block';

  // Ici on passe l'ID pur "reader" sans le '#' à la bibliothèque
  html5QrCode = new Html5Qrcode("reader");

  const config = { 
    fps: 10, 
    qrbox: { width: 250, height: 250 } 
  };

  html5QrCode.start(
    { facingMode: "environment" }, 
    config, 
    onScanSuccess, 
    onScanFailure
  ).catch(err => {
    console.error("Erreur d'initialisation caméra :", err);
    alert("Impossible d'activer la caméra. Assurez-vous d'avoir accordé l'autorisation d'accès et d'être en HTTPS.");
    resetScannerUI();
  });
}

async function onScanSuccess(decodedText) {
  // 1. Arrêt immédiat pour stabiliser la lecture et éviter les erreurs de flux
  await stopScanner();
  
  if (navigator.vibrate) navigator.vibrate(100);

  try {
    // Nettoyage au cas où des caractères invisibles seraient présents
    const cleanText = decodedText.trim();
    const data = JSON.parse(cleanText);
    
    if (!data.id || !data.nom) {
      showScanResult('error', 'Format Invalide', 'Ce QR Code ne provient pas de l\'application UJEEBN.');
      return;
    }

    let p = participants.find(x => x.id === Number(data.id));

    if (!p) {
      showScanResult('error', 'Inconnu', `Le participant "${data.nom}" n'est pas sur la liste.`);
      return;
    }

    if (p.scanned) {
      showScanResult('warn', 'Déjà Scanné', `⚠️ "${p.nom}" a déjà validé son entrée au camp.`);
      return;
    }

    if (!useLocalStorage) {
      await apiFetch(`/api/participants/${p.id}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scanned: true })
      });
    }

    p.scanned = true;
    saveParticipants();
    
    showScanResult('ok', 'Entrée Validée !', `✅ Bienvenue au Camp UJEEBN 2026 :\n${p.nom}\nProvenance : ${p.eglise || '—'}`);

  } catch (e) {
    console.error("Erreur d'analyse QR Code :", e);
    showScanResult('error', 'Erreur de Lecture', 'Impossible de décoder les données du QR Code.');
    // On ne bloque plus l'utilisateur avec une erreur si le scan échoue.
    // L'arrêt du scanner suffit à stopper le cycle d'erreurs.
  }
}

function onScanFailure(error) {
  // Callback silencieux pour éviter les spams en console pendant la recherche de repères
}

async function stopScanner() {
  if (html5QrCode) {
    try {
      await html5QrCode.stop();
    } catch (err) {
      console.warn("Scanner stoppé ou déjà inactif.", err);
    }
    html5QrCode = null;
  }
  resetScannerUI();
}

function resetScannerUI() {
  if (qs('#start-scan-btn')) qs('#start-scan-btn').style.display = 'inline-flex';
  if (qs('#stop-scan-btn')) qs('#stop-scan-btn').style.display = 'none';
  const readerEl = qs('#reader'); // Correction du sélecteur ici aussi
  if (readerEl) {
    readerEl.style.display = 'none';
    readerEl.innerHTML = '';
  }
}

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
function qs(sel)  { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }
function setText(sel, val) { const el = qs(sel); if (el) el.textContent = val; }
function esc(s)   { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════════════════════════════════════════
// CORRECTION LOGIQUE BANDEAU PWA
// ═══════════════════════════════════════════════
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 769;
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;

  if (isMobileDevice() && !localStorage.getItem('pwa_banner_dismissed')) {
    const banner = qs('#pwa-banner');
    if (banner) {
      setTimeout(() => {
        banner.style.display = 'flex';
        banner.style.flexDirection = 'column';
      }, 3000);
    }
  }
});

window.addEventListener('appinstalled', () => {
  const banner = qs('#pwa-banner');
  if (banner) banner.style.display = 'none';
  deferredInstallPrompt = null;
});

// ═══════════════════════════════════════════════
// INIT & DOM LISTENERS
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // Auth
  qs('#login-btn').addEventListener('click', login);
  qs('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  qs('#logout-btn').addEventListener('click', logout);

  if (sessionStorage.getItem('ujeebn_auth') === '1') showApp();

  // Nav sidebar
  qsa('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.view) switchView(btn.dataset.view); });
  });

  // Bottom nav
  qsa('.bnav-item').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.view) switchView(btn.dataset.view); });
  });

  qs('.btn-text')?.addEventListener('click', function() {
    switchView(this.dataset.view || 'participants');
  });

  qs('#sidebar-toggle').addEventListener('click', openSidebar);

  // Participants table
  qs('#search-input')?.addEventListener('input', renderParticipantsTable);
  qsa('.chip').forEach(c => {
    c.addEventListener('click', () => {
      qsa('.chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      currentFilter = c.dataset.filter;
      renderParticipantsTable();
    });
  });
  qs('#generate-all-btn')?.addEventListener('click', generateAllTickets);
  qs('#delete-all-btn')?.addEventListener('click', deleteAll);
  qs('#open-manual-btn')?.addEventListener('click', () => switchView('import'));

  // Ticket modal
  qs('#close-ticket-modal').addEventListener('click', closeTicketModal);
  qs('#close-ticket-footer').addEventListener('click', closeTicketModal);
  qs('#download-ticket-btn').addEventListener('click', downloadTicket);
  qs('#ticket-modal').addEventListener('click', e => { if (e.target === qs('#ticket-modal')) closeTicketModal(); });

  // Scan modal
  qs('#close-scan-modal').addEventListener('click', closeScanModal);
  qs('#scan-modal').addEventListener('click', e => { if (e.target === qs('#scan-modal')) closeScanModal(); });

  // Branchement des écouteurs de la caméra (Modifié)
  if (qs('#start-scan-btn')) qs('#start-scan-btn').addEventListener('click', requestCameraAndStart);
  if (qs('#stop-scan-btn')) qs('#stop-scan-btn').addEventListener('click', stopScanner);

  // Import CSV
  qs('#csv-upload-btn').addEventListener('click', () => qs('#csv-file').click());
  qs('#csv-file').addEventListener('change', e => { if (e.target.files[0]) handleCSVFile(e.target.files[0]); });
  qs('#confirm-import-btn').addEventListener('click', confirmImport);
  qs('#cancel-import-btn').addEventListener('click', cancelImport);

  // Drag & drop CSV
  const dropZone = qs('#csv-drop-zone');
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleCSVFile(file);
  });

  // Manual add
  qs('#save-manual-btn').addEventListener('click', addManualParticipant);

  // Branchement interactif des clics PWA (Modifié)
  qs('#pwa-install-btn')?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        qs('#pwa-banner').style.display = 'none';
      }
      deferredInstallPrompt = null;
    } else {
      alert("L'installation n'est pas disponible pour le moment (déjà installée ou navigateur non compatible).");
    }
  });

  qs('#pwa-close-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    qs('#pwa-banner').style.display = 'none';
    localStorage.setItem('pwa_banner_dismissed', '1');
  });

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }

  // Real-time sync init
  initSocket();
});

// Dynamic Animation Style
const shakeCSS = document.createElement('style');
shakeCSS.textContent = `
  @keyframes shake {
    0%,100%{transform:translateX(0)}
    20%{transform:translateX(-8px)}
    40%{transform:translateX(8px)}
    60%{transform:translateX(-5px)}
    80%{transform:translateX(5px)}
  }
`;
document.head.appendChild(shakeCSS);