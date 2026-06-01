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
        { id: 3, nom: 'Amadou Issaka', dateNaissance: '10/12/2001 à Zinder', eglise: 'Évangélique de Zinder', numero: '91234567', scanned: false, ticketGenerated: false },
        { id: 4, nom: 'Fatima Zakari', dateNaissance: '05/05/1999 à Maradi', eglise: 'Cathédrale Saint-Jean', numero: '92345678', scanned: false, ticketGenerated: false }
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
  const total   = participants.length;
  const tickets = participants.filter(p => p.ticketGenerated).length;
  const scanned = participants.filter(p => p.scanned).length;
  const pending = participants.filter(p => !p.ticketGenerated).length;

  setText('#kpi-total', total);
  setText('#kpi-tickets', tickets);
  setText('#kpi-scanned', scanned);
  setText('#kpi-pending', pending);
  setText('#nav-badge-total', total);

  const tPct = total ? Math.round(tickets / total * 100) : 0;
  const sPct = total ? Math.round(scanned / total * 100) : 0;

  setText('#kpi-tickets-pct', `${tPct}% des inscrits`);
  setText('#kpi-scanned-pct', `${sPct}% présents`);

  setText('#progress-label', `${scanned} / ${total}`);
  setText('#progress-tickets-label', `${tickets} / ${total}`);

  qs('#progress-fill').style.width = `${sPct}%`;
  qs('#progress-tickets-fill').style.width = `${tPct}%`;

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
      <span class="recent-status ${p.scanned ? 'status-scanned' : p.ticketGenerated ? 'status-ready' : 'status-pending'}">
        ${p.scanned ? '✓ Scanné' : p.ticketGenerated ? '🎫 Ticket' : '📝 Inscrit'}
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
  else if (currentFilter === 'ticket') list = list.filter(p => p.ticketGenerated && !p.scanned);
  else if (currentFilter === 'pending') list = list.filter(p => !p.ticketGenerated);

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
        <span class="recent-status ${p.scanned ? 'status-scanned' : p.ticketGenerated ? 'status-ready' : 'status-pending'}">
          ${p.scanned ? '✓ Scanné' : p.ticketGenerated ? '🎫 Prêt' : '📝 Inscrit'}
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
  const untreated = participants.filter(p => !p.ticketGenerated);
  if (untreated.length === 0) return alert('Tous les tickets ont déjà été générés !');
  if (!useLocalStorage) {
    try {
      await Promise.all(untreated.map(p => apiFetch(`/api/participants/${p.id}/generate`, { method: 'PUT' })));
    } catch (err) {
      console.error(err);
      return alert('Erreur lors de la génération de tous les tickets.');
    }
  }
  untreated.forEach(p => p.ticketGenerated = true);
  saveParticipants();
  renderParticipantsTable();
  alert(`✅ ${untreated.length} tickets générés !`);
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
      <span class="ticket-mini-status ${p.scanned ? 'status-scanned' : p.ticketGenerated ? 'status-ready' : 'status-pending'}">
        ${p.scanned ? '✓ Scanné' : p.ticketGenerated ? '🎫 Ticket généré' : '📝 Pas de ticket'}
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
  const initials = p.nom.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  qs('#ticket-to-export').innerHTML = buildTicketHTML(p, initials);

  setTimeout(() => {
    renderQRCode('#ticket-qr-code', qrData);
  }, 80);

  if (!p.ticketGenerated) {
    let success = true;
    if (!useLocalStorage) {
      try {
        await apiFetch(`/api/participants/${p.id}/generate`, { method: 'PUT' });
      } catch (err) {
        console.error(err);
        alert('Impossible de marquer le ticket comme généré.');
        success = false;
      }
    }
    if (success) {
      p.ticketGenerated = true;
      saveParticipants();
    }
  }

  qs('#ticket-modal').classList.add('active');
}

function buildTicketHTML(p, initials) {
  return `
  <div id="ticket-inner" style="display:flex; width:100%; max-width:900px; min-height:260px; border-radius:20px; overflow:hidden; background:#fff; box-shadow:0 16px 48px rgba(0,0,0,.24); font-family:'DM Sans',Arial,sans-serif;">
    <div style="width:260px; min-width:260px; padding:28px 24px; background:#111; color:#fff; display:flex; flex-direction:column; justify-content:center; gap:12px;">
      <div style="font-family:'Syne',Arial,sans-serif; font-size:.95rem; font-weight:800; letter-spacing:.08em; line-height:1.1;">CAMP BIBLIQUE UJEEBN</div>
      <div style="font-family:'Syne',Arial,sans-serif; font-size:2.4rem; font-weight:800; line-height:1; margin-top:4px;">2026</div>
      <div style="color:rgba(255,255,255,.7); font-size:.85rem; line-height:1.5; margin-top:14px;">36ème édition · Dosso · 02-07 Août 2026</div>
    </div>
    <div style="flex:1; display:flex; flex-direction:column; justify-content:space-between; padding:28px 24px; background:#fff;">
      <div>
        <div style="font-family:'Syne',Arial,sans-serif; font-size:2.2rem; font-weight:800; color:#111; margin-bottom:18px; line-height:1.05;">${esc(p.nom)}</div>
        <div style="display:grid; grid-template-columns: auto 1fr; gap:10px 18px; row-gap:14px; color:#555; font-size:.95rem;">
          <div style="display:flex; align-items:center; gap:10px;"><span class="material-icons-round" style="font-size:1rem; color:#999;">cake</span><span>Date</span></div><div style="color:#222; font-weight:500;">${esc(p.dateNaissance || '—')}</div>
          <div style="display:flex; align-items:center; gap:10px;"><span class="material-icons-round" style="font-size:1rem; color:#999;">account_balance</span><span>Église</span></div><div style="color:#222; font-weight:500;">${esc(p.eglise || '—')}</div>
          <div style="display:flex; align-items:center; gap:10px;"><span class="material-icons-round" style="font-size:1rem; color:#999;">tag</span><span>ID</span></div><div style="color:#222; font-weight:700;">${p.id}</div>
        </div>
      </div>
      <div style="display:flex; align-items:flex-end; gap:18px; margin-top:20px;">
        <div style="padding:12px; border:2px solid #111; border-radius:18px; background:#fff; line-height:0;">
          <div id="ticket-qr-code" style="width:160px; height:160px;"></div>
        </div>
        <div style="font-size:.9rem; color:#777; letter-spacing:.02em; line-height:1.4;">Scanner pour valider</div>
      </div>
    </div>
    <div style="width:260px; min-width:260px; padding:28px 24px; background:#f5f5f8; display:flex; align-items:center; justify-content:center; text-align:center; color:#666; font-size:1rem; font-style:italic; line-height:1.5;">
      "Témoigne du Christ par ta vie" — Matthieu 5:14-16
    </div>
  </div>
  `;
}
function renderQRCode(selector, qrData) {
  const qrEl = qs(selector);
  if (!qrEl || typeof QRCode === 'undefined') return;
  qrEl.innerHTML = '';
  new QRCode(qrEl, {
    text: qrData,
    width: 160,
    height: 160,
    colorDark: '#1a1a2e',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

// Remplacez votre fonction downloadTicket par celle-ci :

function downloadTicket() {
  const el = qs('#ticket-inner');
  if (!el || !currentTicketParticipant) return;

  // Afficher un indicateur de chargement
  const downloadBtn = qs('#download-ticket-btn');
  const originalText = downloadBtn.innerHTML;
  downloadBtn.innerHTML = '<span class="material-icons-round">hourglass_empty</span> Génération...';
  downloadBtn.disabled = true;

  // S'assurer que le QR code est complètement rendu
  const qrContainer = qs('#ticket-qr-code');
  if (qrContainer && qrContainer.children.length === 0 && currentTicketParticipant) {
    const qrData = JSON.stringify({ id: currentTicketParticipant.id, nom: currentTicketParticipant.nom });
    renderQRCode('#ticket-qr-code', qrData);
  }

  // Attendre que le QR code soit bien rendu (plus de temps)
  setTimeout(() => {
    html2canvas(el, {
      scale: 3,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      onclone: (clonedDoc, element) => {
        // Forcer le style du clone pour correspondre exactement
        const clonedEl = clonedDoc.querySelector('#ticket-inner');
        if (clonedEl) {
          clonedEl.style.display = 'flex';
          clonedEl.style.width = '900px';
          clonedEl.style.minHeight = '260px';
          clonedEl.style.borderRadius = '16px';
          clonedEl.style.overflow = 'hidden';
          
          // S'assurer que le QR code est présent dans le clone
          const clonedQr = clonedDoc.querySelector('#ticket-qr-code');
          if (clonedQr && clonedQr.children.length === 0 && currentTicketParticipant) {
            // Re-générer le QR dans le clone si nécessaire
            const qrData = JSON.stringify({ id: currentTicketParticipant.id, nom: currentTicketParticipant.nom });
            new QRCode(clonedQr, {
              text: qrData,
              width: 160,
              height: 160,
              colorDark: '#1a1a2e',
              colorLight: '#ffffff',
              correctLevel: QRCode.CorrectLevel.H
            });
          }
        }
      }
    }).then(canvas => {
      const link = document.createElement('a');
      link.download = `Ticket_${currentTicketParticipant.nom.replace(/\s+/g, '_')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      
      // Restaurer le bouton
      downloadBtn.innerHTML = originalText;
      downloadBtn.disabled = false;
    }).catch(err => {
      console.error('Erreur capture ticket:', err);
      alert('Erreur lors de la génération. Réessayez.');
      downloadBtn.innerHTML = originalText;
      downloadBtn.disabled = false;
    });
  }, 500); // Attendre 500ms pour un rendu complet
}
// ═══════════════════════════════════════════════
// SCANNER
// ═══════════════════════════════════════════════
function startScanner() {
  const box = qs('#qr-reader');
  box.innerHTML = '';
  html5QrCode = new Html5Qrcode('qr-reader');
  html5QrCode.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: { width: 250, height: 250 } },
    onScanSuccess,
    () => {}
  ).catch(err => {
    console.error(err);
    alert('Impossible d\'accéder à la caméra. Vérifiez les permissions.');
  });
}

async function requestCameraAndStart() {
  // Prompt for camera permission first to get explicit approval
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return alert('Votre navigateur ne supporte pas l\'accès caméra.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // stop the stream immediately; Html5Qrcode will request again when starting
    stream.getTracks().forEach(t => t.stop());
    startScanner();
  } catch (err) {
    console.error('Permission caméra refusée', err);
    alert('Permission caméra refusée. Autorisez la caméra pour scanner.');
  }
}

function stopScanner() {
  if (html5QrCode) {
    html5QrCode.stop().catch(() => {});
    html5QrCode = null;
  }
}

async function onScanSuccess(text) {
  stopScanner();
  try {
    const data = JSON.parse(text);
    const p = participants.find(x => x.id === data.id);
    if (!p) {
      addScanEntry(null, 'error');
      showScanResult('error', '❌ Non inscrit', 'Ce QR code n\'est pas reconnu dans le système');
    } else if (p.scanned) {
      addScanEntry(p, 'warn');
      showScanResult('warn', '⚠️ Déjà validé', `${p.nom} a déjà été scanné`);
    } else {
      let success = true;
      if (!useLocalStorage) {
        try {
          await apiFetch(`/api/participants/${p.id}/scan`, { method: 'PUT' });
        } catch (err) {
          console.error(err);
          success = false;
          alert('Erreur lors de la validation du ticket.');
        }
      }
      if (success) {
        p.scanned = true;
        saveParticipants();
        addScanEntry(p, 'ok');
        showScanResult('ok', '✅ Entrée validée !', `${p.nom} est bien enregistré`);
      }
    }
  } catch {
    addScanEntry(null, 'error');
    showScanResult('error', '❌ QR invalide', 'Code non reconnu par le système');
  }
}

function addScanEntry(p, type) {
  const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  scanHistory.unshift({ p, type, time: now });
  renderScanHistory();
}

function renderScanHistory() {
  const el = qs('#scan-history');
  if (scanHistory.length === 0) {
    el.innerHTML = '<div class="scan-empty">Aucun scan récent</div>';
    return;
  }
  el.innerHTML = scanHistory.slice(0, 20).map(entry => `
    <div class="scan-entry">
      <div class="scan-entry-icon scan-${entry.type}">
        <span class="material-icons-round" style="font-size:1rem">
          ${entry.type === 'ok' ? 'check' : entry.type === 'warn' ? 'warning' : 'error'}
        </span>
      </div>
      <div>
        <div class="scan-entry-name">${entry.p ? esc(entry.p.nom) : 'Inconnu'}</div>
        <div class="scan-entry-time">${entry.time}</div>
      </div>
    </div>
  `).join('');
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

  if (!useLocalStorage) {
    try {
      await apiFetch('/api/participants/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toAdd)
      });
      await loadParticipants();
    } catch (err) {
      console.error(err);
      return alert('Erreur lors de l’import CSV.');
    }
  } else {
    toAdd.forEach(p => {
      participants.push({
        id: getNextId(),
        nom: p.nom,
        dateNaissance: p.dateNaissance,
        eglise: p.eglise,
        numero: p.numero,
        scanned: false,
        ticketGenerated: false
      });
    });
    saveParticipants();
  }

  cancelImport();
  switchView('participants');
  alert(`✅ ${toAdd.length} participants importés !`);
}

function cancelImport() {
  pendingCSVData = [];
  qs('#csv-preview-section').style.display = 'none';
  qs('#csv-file').value = '';
}

// ═══════════════════════════════════════════════
// ADD MANUAL
// ═══════════════════════════════════════════════
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
    numero: qs('#manual-numero').value.trim()
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
        ticketGenerated: false
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
      ticketGenerated: false
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
// PWA
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// PWA — BANNIÈRE MOBILE UNIQUEMENT
// ═══════════════════════════════════════════════
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
    || window.innerWidth < 769;
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;

  // N'afficher que sur mobile ET si pas déjà dismissé ET si connecté
  if (isMobileDevice() && !localStorage.getItem('pwa_banner_dismissed')) {
    const banner = qs('#pwa-banner');
    if (banner) {
      setTimeout(() => {
        banner.style.display = 'flex';
        banner.style.flexDirection = 'column';
      }, 3000); // 3s après connexion
    }
  }
});

// Masquer si déjà installée
window.addEventListener('appinstalled', () => {
  const banner = qs('#pwa-banner');
  if (banner) banner.style.display = 'none';
});

// ═══════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════
function qs(sel)  { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }
function setText(sel, val) { const el = qs(sel); if (el) el.textContent = val; }
function esc(s)   { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // Auth
  qs('#login-btn').addEventListener('click', login);
  qs('#login-password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  qs('#logout-btn').addEventListener('click', logout);

  // Session persistante
  if (sessionStorage.getItem('ujeebn_auth') === '1') showApp();

  // Nav sidebar
  qsa('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.view) switchView(btn.dataset.view); });
  });

  // Bottom nav
  qsa('.bnav-item').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.view) switchView(btn.dataset.view); });
  });

  // "Voir tous" dashboard
  qs('.btn-text')?.addEventListener('click', function() {
    switchView(this.dataset.view || 'participants');
  });

  // Topbar menu
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

  // Scanner
  qs('#start-scan-btn').addEventListener('click', requestCameraAndStart);
  qs('#stop-scan-btn').addEventListener('click', stopScanner);

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

  // PWA banner
 // PWA banner
  qs('#pwa-install-btn')?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        qs('#pwa-banner').style.display = 'none';
      }
      deferredInstallPrompt = null;
    }
  });

  qs('#pwa-close-btn')?.addEventListener('click', () => {
    qs('#pwa-banner').style.display = 'none';
    localStorage.setItem('pwa_banner_dismissed', '1');
  });

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
  }

  // Initialize Socket.IO client (real-time sync)
  initSocket();
});

// Shake animation CSS (injectée dynamiquement)
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