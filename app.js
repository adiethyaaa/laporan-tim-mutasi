import { db, auth } from "./firebase-config.js";
import { ref, push, onValue, remove, update, set, get } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { renderUserManagementTable, setupAdminRegisterForm, getColorForInitial } from "./admin.js";

// ==========================================
// 0. FUNGSI INJEKSI FAVICON OTOMATIS
// ==========================================
function injectDynamicFavicon() {
    let link = document.querySelector("link[rel*='icon']");
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%230f172a"/><text x="50%" y="55%" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="28" fill="%2338bdf8">KR14</text></svg>';
}
document.addEventListener("DOMContentLoaded", injectDynamicFavicon);

// ==========================================
// 1. VARIABEL GLOBAL & KONSTANTA
// ==========================================
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 Menit Inaktivitas
const NAMA_BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

let sessionTimer = null, isLoggingOut = false;
let selectedFilesQueue = [], selectedFilesQueuePI = [];
let dbFetchedMap = {}, combinedDataList = [];
let mainTotalChart = null, donutChartInstancesMap = {}; 
let isFirstDbLoad = true, previousDbSnapshot = null, dbUnsubscribe = null;
let currentSortColumn = 'tgl_pengiriman_kelayanan', isAscending = false;
let selectedDbKeys = new Set();

let currentUserInitial = '--', currentUserRole = 'User', currentUserAllowDelete = false, currentModule = 'KP'; 
window.currentDashboardFilteredData = []; // VARIABEL PENYIMPAN DATA FILTER DASHBOARD GLOBAL
window.includeKPO = true; // VARIABEL GLOBAL STATUS KPO (DEFAULT: TRUE / ON)

const MODULE_CONFIG = {
    'KP': { node: 'usulan_kp', title: 'Laporan Pelayanan Kenaikan Pangkat (KP)' },
    'PI': { node: 'usulan_pi', title: 'Laporan Pelayanan Pindah Instansi (PI)' }
};

// ==========================================
// 2. MANAJEMEN SESI (LOCAL STORAGE & SLEEP CHECK)
// ==========================================
function checkSessionExpiration() {
    if (isLoggingOut) return false;

    const lastActivity = localStorage.getItem('last_user_activity');
    const now = Date.now();

    if (lastActivity && (now - parseInt(lastActivity, 10)) >= SESSION_TIMEOUT_MS) {
        triggerSessionExpired();
        return false;
    }
    return true;
}

function resetSessionTimer() {
    if (isLoggingOut) return;
    
    // Cek dulu apakah sesi sebenarnya sudah kadaluarsa sebelum me-reset timer
    const lastActivity = localStorage.getItem('last_user_activity');
    const now = Date.now();

    if (lastActivity && (now - parseInt(lastActivity, 10)) >= SESSION_TIMEOUT_MS) {
        triggerSessionExpired();
        return;
    }

    if (sessionTimer) clearTimeout(sessionTimer);
    localStorage.setItem('last_user_activity', now.toString());
    sessionTimer = setTimeout(triggerSessionExpired, SESSION_TIMEOUT_MS);
}

async function triggerSessionExpired() {
    if (isLoggingOut) return;
    isLoggingOut = true; 
    
    if (!document.querySelector('.session-expired-overlay')) {
        const overlay = document.createElement('div'); 
        overlay.className = 'session-expired-overlay';
        overlay.innerHTML = `
            <div class="session-expired-card">
                <div style="font-size: 50px; margin-bottom: 10px;">⏰</div>
                <h2 style="margin: 0 0 10px 0; color: #0f172a;">Sesi Anda telah Berakhir</h2>
                <p style="color: #64748b; font-size: 14px; margin-bottom: 0;">Waktu sesi aktif telah habis (termasuk saat device sleep).<br>Mengalihkan ke halaman login...</p>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    try { 
        sessionStorage.clear(); 
        localStorage.clear(); 
        await signOut(auth); 
    } catch (e) { 
        console.error(e); 
    } finally { 
        window.location.replace("login.html"); 
    }
}

function setupActivityListeners() { 
    // Listener interaksi pengguna
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetSessionTimer, { passive: true });
    }); 

    // DETEKSI SLEEP / BANGUN LAPTOP:
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkSessionExpiration();
        }
    });

    window.addEventListener('focus', () => {
        checkSessionExpiration();
    });
}

// ==========================================
// 3. HELPER UTILS & FORMATTER
// ==========================================
function normalizeValue(val) { 
    if (val === null || val === undefined) return '--'; 
    let str = String(val).trim(); 
    if (str === '' || str === '-' || str === '<nil>') return '--'; 
    
    // Mencegah XSS Attack
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatDateTime(isoString) { 
    if (!isoString || isoString === '--') return 'Waktu simpan tidak tercatat'; 
    const d = new Date(isoString); 
    if (isNaN(d.getTime())) return isoString; 
    
    return `${String(d.getDate()).padStart(2, '0')} ${NAMA_BULAN[d.getMonth()]} ${d.getFullYear()}, Pukul ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} WIT`; 
}

// ==========================================
// HELPER: PENGECEKAN KELAYAKAN DATA KPO & KANREG
// ==========================================
window.isEligibleForApp = function(item) {
    if (!item) return false;

    // 1. FILTER PENGECEKAN GOLONGAN IV/c: Abaikan jika bernilai IV/c
    const golBaru = item.gol_tmt_baru || item.golongan_ruang || '';
    const golLama = item.gol_tmt_lama || '';
    if (typeof isGolonganIVc === 'function' && (isGolonganIVc(golBaru) || isGolonganIVc(golLama))) {
        return false;
    }

    // 2. LOGIKA KANREG & KPO BAWAAN ANDA
    const kanreg = String(item.kanreg_operator ?? '').trim();
    const statusKpoStr = String(item.status_kpo ?? '').trim().toLowerCase();
    const isKpo = (statusKpoStr === 'true' || statusKpoStr === '1' || statusKpoStr === 'ya');
    
    const isKanregNol = (kanreg === '0' || kanreg === '00' || parseInt(kanreg, 10) === 0);
    
    // Tampil jika kanreg 14, ATAU (kanreg 0/00 DAN status KPO True)
    return (kanreg === '14') || (isKanregNol && isKpo);
};


window.checkIsKPO = function(item) {
    const kanreg = String(item.kanreg_operator ?? '').trim();
    const statusKpoStr = String(item.status_kpo ?? '').trim().toLowerCase();
    
    const isKanregNol = (kanreg === '0' || kanreg === '00' || parseInt(kanreg, 10) === 0);
    const isKpo = (statusKpoStr === 'true' || statusKpoStr === '1' || statusKpoStr === 'ya');
    
    // Murni mengecek apakah ini usulan KPO otomatis
    return (isKanregNol && isKpo);
};

function categoriseStatus(status) {
    if (!status || status === '--') return 'Inbox';
    const c = String(status).trim().toLowerCase();

    if (c.includes('approval') || c.includes('approval surat usulan') || c.includes('approval usulan') || c.includes('inbox') || c.includes('usulan masuk') || c.includes('draft')) {
        return 'Inbox';
    }
    if (c.includes('tms') || c.includes('tidak memenuhi')) {
        return 'TMS';
    }
    if (c.includes('bts') || c.includes('perbaikan') || c.includes('berkas tidak sesuai') || c.includes('dokumen')) {
        return 'BTS';
    }
    if (c.includes('setuju') || c.includes('ttd sk') || c.includes('ttd pertek') || c.includes('sdh di ttd') || c.includes('sudah di ttd') || c.includes('pembuatan sk berhasil') || c.includes('sk berhasil') || c.includes('ms') || c.includes('acc')) {
        return 'MS';
    }
    return 'Inbox';
}

function formatJenisKP(jenisKP) { 
    const text = normalizeValue(jenisKP); 
    if (text === '--') return '--'; 
    if (text.includes("Memperoleh Ijazah") || text.includes("Penyesuaian Ijazah")) return "KP Penyesuaian Ijazah"; 
    if (text.includes("Reguler")) return "KP Reguler"; 
    if (text.includes("Jabatan Fungsional") || text.includes("Fungsional")) return "KP JF"; 
    if (text.includes("Struktural")) return "KP Struktural"; 
    return text; 
}

function cleanInstansiName(name) { 
    const norm = normalizeValue(name); 
    return norm === '--' ? '--' : norm.replace(/^Pemerintah\s+/i, '').trim(); 
}

function formatTanggal(excelDate) { 
    if (!excelDate || excelDate === '<nil>') return '--'; 
    if (typeof excelDate === 'number') { 
        const date = new Date((excelDate - 25569) * 86400 * 1000); 
        return date.toISOString().split('T')[0]; 
    } 
    const str = String(excelDate).substring(0, 10); 
    return str.trim() !== '' ? str : '--'; 
}

function formatFileSize(bytes) { 
    if (bytes === 0) return '0 Bytes'; 
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k)); 
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]; 
}

function calculatePeriodeKP(tglUsulMasuk) {
    if (!tglUsulMasuk || tglUsulMasuk === '--') return '--';
    const parts = String(tglUsulMasuk).trim().split('-');
    if (parts.length !== 3) return '--';
    
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10); 
    const day = parseInt(parts[2], 10);

    if (isNaN(year) || isNaN(month) || isNaN(day)) return '--';

    let targetMonthIdx;
    if (day >= 16) {
        targetMonthIdx = (month - 1) + 2; 
    } else {
        targetMonthIdx = (month - 1) + 1;
    }

    let finalYear = year + Math.floor(targetMonthIdx / 12);
    let finalMonthIdx = targetMonthIdx % 12;

    return `${NAMA_BULAN[finalMonthIdx]} ${finalYear}`;
}

function isValidExcelStructure(rows) {
    if (!rows || rows.length < 4) return false;
    let headerMatch = false;
    for (let r = 0; r < Math.min(rows.length, 4); r++) { 
        const rowStr = JSON.stringify(rows[r] || '').toLowerCase(); 
        if (rowStr.includes('instansi') || rowStr.includes('nip') || rowStr.includes('nama')) { 
            headerMatch = true; break; 
        } 
    }
    let validSampleCount = 0;
    for (let i = 3; i < Math.min(rows.length, 15); i++) { 
        const row = rows[i]; if (!row) continue; 
        const instansi = normalizeValue(row[0]), nip = normalizeValue(row[12]); 
        if (instansi !== '--' && nip !== '--' && String(nip).replace(/\D/g, '').length >= 8) validSampleCount++; 
    }
    return headerMatch && (validSampleCount > 0);
}

function isValidExcelStructurePI(rows) {
    if (!rows || rows.length === 0) return false;
    const header = rows[0].map(cell => String(cell).toUpperCase().trim());
    
    // Cek apakah ada kolom NAMA dan NIP di header Excel
    const hasNama = header.some(h => h.includes("NAMA"));
    const hasNip = header.some(h => h.includes("NIP"));
    
    return hasNama && hasNip;
}

// ==========================================
// 4. AUTHENTICATION & AWAL MASUK APLIKASI
// ==========================================
onAuthStateChanged(auth, async (user) => {
    // 1. Validasi Timeout & Sesi
    const lastActivity = localStorage.getItem('last_user_activity');
    const now = Date.now();
    const isTimeout = !lastActivity || (now - parseInt(lastActivity, 10)) >= SESSION_TIMEOUT_MS;

    if (!user || isTimeout) {
        if (user) await signOut(auth);
        sessionStorage.clear(); 
        localStorage.clear(); 
        window.location.replace("login.html"); 
        return;
    }

    // 2. Perbarui waktu aktivitas
    localStorage.setItem('last_user_activity', Date.now().toString());
    
    // Sembunyikan semua section terlebih dahulu
    document.querySelectorAll('.section').forEach(sec => { 
        sec.classList.remove('active'); 
        sec.style.display = 'none'; 
    });

    document.getElementById('sidebarContainer').style.display = 'block'; 
    document.getElementById('mainContent').style.display = 'block';
    
    setupActivityListeners();
    resetSessionTimer();

    let namaUserDisplay = user.email;
    let targetSectionToOpen = 'profile-page'; // Default landing page

    try {
        const snapshot = await get(ref(db, `users/${user.uid}`));
        const userData = snapshot.val();
        
        currentUserInitial = (userData && userData.id_inisial) ? userData.id_inisial.trim().toUpperCase() : '--';
        currentUserRole = (userData && userData.role) ? userData.role : 'User';
        currentUserAllowDelete = Boolean(userData?.allow_delete_selected);

        // PENENTUAN STATUS ADMIN MURNI UNTUK HAK AKSES KELOLA USER
        const isTrueAdminRole = (currentUserRole.toLowerCase() === 'admin');
        
        // HANYA MUNCULKAN AREA KELOLA PENGGUNA JIKA ROLE BENAR-BENAR 'ADMIN'
        const adminUserMgmtArea = document.getElementById('adminUserManagementArea');
        if (adminUserMgmtArea) {
            adminUserMgmtArea.style.display = isTrueAdminRole ? 'block' : 'none';
        }

        if (userData?.nama) namaUserDisplay = userData.nama;
        const userAvatarEl = document.getElementById('sidebarUserAvatar');
        
        if (userAvatarEl) {
            const colorObj = getColorForInitial(currentUserInitial);
            userAvatarEl.innerText = currentUserInitial; 
            userAvatarEl.style.backgroundColor = colorObj.bg; 
            userAvatarEl.style.color = colorObj.color;
        }
        
        if (document.getElementById('sidebarUserEmail')) document.getElementById('sidebarUserEmail').innerText = namaUserDisplay;
        if (document.getElementById('sidebarUserRole')) document.getElementById('sidebarUserRole').innerText = currentUserRole;

        // 3. PENGATURAN HAK AKSES MENU SIDEBAR
        if (userData && userData.menus) {
            const menus = userData.menus;

            const canDashboard = Boolean(menus.dashboard);
            const canAccessKP = Boolean(menus.kp ?? menus.aplikasi);
            const canAccessPGA = Boolean(menus.pga ?? menus.aplikasi);
            const canAccessPI = Boolean(menus.pi ?? menus.aplikasi);
            const canAccessAdminMenu = isTrueAdminRole || Boolean(menus.admin);

            // Tampilkan / Sembunyikan Item Menu Sidebar
            if (document.getElementById('nav-dashboard')) document.getElementById('nav-dashboard').style.display = canDashboard ? 'flex' : 'none';
            if (document.getElementById('nav-aplikasi-kp')) document.getElementById('nav-aplikasi-kp').style.display = canAccessKP ? 'flex' : 'none';
            if (document.getElementById('nav-aplikasi-pga')) document.getElementById('nav-aplikasi-pga').style.display = canAccessPGA ? 'flex' : 'none';
            if (document.getElementById('nav-aplikasi-pi')) document.getElementById('nav-aplikasi-pi').style.display = canAccessPI ? 'flex' : 'none';
            if (document.getElementById('nav-admin')) document.getElementById('nav-admin').style.display = canAccessAdminMenu ? 'flex' : 'none';

            targetSectionToOpen = 'profile-page';
        }
    } catch (e) { 
        console.error("Gagal memuat profil user:", e); 
    }

    if (typeof setupChangePasswordForm === 'function') {
        setupChangePasswordForm();
    }

    if (typeof showSection === 'function') {
        showSection(targetSectionToOpen);
    }

    updateWelcomeHeader(namaUserDisplay); 
    startDigitalClockWIT();
    setupSidebarToggle(); 
    initCharts(); 
    setupDragAndDrop(); 
    setupDragAndDropPI(); 
    setupToggleUploadForm();
    
    currentModule = 'KP'; 
    loadDatabaseData();
    
    if (currentUserRole.toLowerCase() === 'admin') {
        setupAdminRegisterForm(); 
        renderUserManagementTable();
    }
});

// LOGOUT MODAL KONTROL
const logoutModalEl = document.getElementById('logoutModal'), btnTriggerLogout = document.getElementById('btnTriggerLogout');
const btnConfirmLogout = document.getElementById('btnConfirmLogoutModal'), btnCancelLogout1 = document.getElementById('btnCancelLogoutModal'), btnCancelLogout2 = document.getElementById('btnCancelLogoutAction');

if (btnTriggerLogout && logoutModalEl) { 
    btnTriggerLogout.addEventListener('click', (e) => { 
        e.preventDefault(); 
        logoutModalEl.style.display = 'flex'; 
        const innerCard = logoutModalEl.querySelector('.modal-content'); 
        if (innerCard) innerCard.style.display = 'block'; 
    }); 
}

const closeLogoutModal = () => { if (logoutModalEl) logoutModalEl.style.display = 'none'; };
if (btnCancelLogout1) btnCancelLogout1.addEventListener('click', closeLogoutModal); 
if (btnCancelLogout2) btnCancelLogout2.addEventListener('click', closeLogoutModal);
logoutModalEl?.addEventListener('click', (e) => { if (e.target === logoutModalEl) closeLogoutModal(); });

if (btnConfirmLogout) { 
    btnConfirmLogout.addEventListener('click', async () => { 
        btnConfirmLogout.disabled = true; 
        btnConfirmLogout.innerText = 'Keluar...'; 
        try { 
            localStorage.clear(); 
            sessionStorage.clear(); 
            await signOut(auth); 
            window.location.replace("login.html"); 
        } catch (e) { 
            alert("Gagal keluar: " + e.message); 
            btnConfirmLogout.disabled = false; 
            btnConfirmLogout.innerText = 'Ya, Keluar Saja'; 
        } 
    }); 
}

// ==========================================
// 5. DATABASE FIREBASE LOAD
// ==========================================
function loadDatabaseData() {
    if (!MODULE_CONFIG[currentModule]) return; 
    isFirstDbLoad = true;
    
    if (currentModule === 'PI') renderTablePI([]); 
    else renderAllTableRows([]);
    
    if (dbUnsubscribe) dbUnsubscribe();
    
    dbUnsubscribe = onValue(ref(db, MODULE_CONFIG[currentModule].node), (snapshot) => {
        try {
            dbFetchedMap = snapshot.val() || {}; 
            isFirstDbLoad = false;
            
            if (currentModule === 'PI') {
                populateDropdownFiltersPI(); 
            } else {
                populateDropdownFilters();
            }
            refreshAllDisplays();
        } catch (err) {
            console.error(err); 
            isFirstDbLoad = false; 
            const errHtml = `<tr><td colspan="16" style="text-align: center; color: #e74c3c;">⚠️ Gagal Memproses Data</td></tr>`;
            if (currentModule === 'PI') document.getElementById('tableBodyPI').innerHTML = errHtml; 
            else document.getElementById('tableBody').innerHTML = errHtml;
        }
    }, (error) => {
        isFirstDbLoad = false; 
        const errHtml = `<tr><td colspan="16" style="text-align: center; color: #e74c3c;">⚠️ Gagal Menarik Data Firebase</td></tr>`;
        if (currentModule === 'PI') document.getElementById('tableBodyPI').innerHTML = errHtml; 
        else document.getElementById('tableBody').innerHTML = errHtml;
    });
}

// ==========================================
// 6. POPULATE DROPDOWNS & RENDER DISPLAYS
// ==========================================
function populateDropdownFilters() {
    const instansiSet = new Set(), periodeSet = new Set();
    Object.values(dbFetchedMap).forEach(item => {
        if (!window.isEligibleForApp(item)) return;
        
        if (item.instansi_induk && item.instansi_induk !== '--') instansiSet.add(item.instansi_induk);
        const periode = calculatePeriodeKP(item.tgl_pengiriman_kelayanan);
        if (periode !== '--') periodeSet.add(periode);
    });

    ['filterInstansi', 'dashFilterInstansi'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { 
            const v = el.value; 
            el.innerHTML = '<option value="">-- Semua Instansi --</option>'; 
            Array.from(instansiSet).sort().forEach(fullInst => { 
                const opt = document.createElement('option'); 
                opt.value = fullInst; 
                opt.textContent = cleanInstansiName(fullInst); 
                el.appendChild(opt); 
            }); 
            el.value = v; 
        }
    });
    
    ['filterPeriodeKP', 'dashFilterPeriodeKP'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { 
            const v = el.value; 
            el.innerHTML = '<option value="">-- Semua Periode --</option>'; 
            Array.from(periodeSet).sort().forEach(p => { 
                const opt = document.createElement('option'); 
                opt.value = p; 
                opt.textContent = p; 
                el.appendChild(opt); 
            }); 
            el.value = v; 
        }
    });
}

function populateDropdownFiltersPI() {
    const filterAsalEl = document.getElementById('filterInstansiAsalPI');
    const filterTujuanEl = document.getElementById('filterInstansiTujuanPI');

    if (!filterAsalEl || !filterTujuanEl) return;

    // Simpan nilai yang sedang dipilih user agar pilihan tidak ter-reset
    const currentAsal = filterAsalEl.value;
    const currentTujuan = filterTujuanEl.value;

    const instansiAsalSet = new Set();
    const instansiTujuanSet = new Set();

    // Ambil array data dari objek dbFetchedMap
    const records = Object.values(dbFetchedMap || {});

    // Ekstraksi HANYA nama instansi yang exist pada data
    records.forEach(rec => {
        if (rec.instansi_asal && String(rec.instansi_asal).trim() !== '') {
            const asalBaku = (typeof standardizeInstansiName === 'function') 
                ? standardizeInstansiName(rec.instansi_asal) 
                : String(rec.instansi_asal).trim();
            instansiAsalSet.add(asalBaku);
        }

        if (rec.instansi_tujuan && String(rec.instansi_tujuan).trim() !== '') {
            const tujuanBaku = (typeof standardizeInstansiName === 'function') 
                ? standardizeInstansiName(rec.instansi_tujuan) 
                : String(rec.instansi_tujuan).trim();
            instansiTujuanSet.add(tujuanBaku);
        }
    });

    // Urutkan alfabetis A-Z
    const sortedAsal = Array.from(instansiAsalSet).sort((a, b) => a.localeCompare(b));
    const sortedTujuan = Array.from(instansiTujuanSet).sort((a, b) => a.localeCompare(b));

    // Susun elemen <option>
    let optionsHtmlAsal = '<option value="">-- Semua Instansi Asal --</option>';
    sortedAsal.forEach(nama => {
        optionsHtmlAsal += `<option value="${nama}">${nama}</option>`;
    });

    let optionsHtmlTujuan = '<option value="">-- Semua Instansi Tujuan --</option>';
    sortedTujuan.forEach(nama => {
        optionsHtmlTujuan += `<option value="${nama}">${nama}</option>`;
    });

    // Masukkan ke elemen <select>
    filterAsalEl.innerHTML = optionsHtmlAsal;
    filterTujuanEl.innerHTML = optionsHtmlTujuan;

    // Kembalikan pilihan user sebelumnya
    filterAsalEl.value = currentAsal;
    filterTujuanEl.value = currentTujuan;
}

function refreshAllDisplays() {
    if (currentModule === 'PI') {
        combinedDataList = Object.keys(dbFetchedMap).map(key => ({ dbKey: key, ...dbFetchedMap[key] }));
        
        const sAsal = document.getElementById('filterInstansiAsalPI')?.value || '';
        const sTujuan = document.getElementById('filterInstansiTujuanPI')?.value || '';
        const sWilker = document.getElementById('filterWilkerPI')?.value || '';
        const sStatus = document.getElementById('filterStatusPI')?.value || '';
        
        let filtered = combinedDataList.filter(item => { 
            return (!sAsal || item.instansi_asal === sAsal) && 
                   (!sTujuan || item.instansi_tujuan === sTujuan) && 
                   (!sWilker || item.wilker_prov === sWilker) && 
                   (!sStatus || item.status === sStatus); 
        });
        
        sortDataListPI(filtered); 
        renderTablePI(filtered);
    } else {
        // PERBAIKAN: Kecualikan data IV/c saat membentuk combinedDataList
        combinedDataList = Object.keys(dbFetchedMap)
            .map(key => ({ 
                dbKey: key, 
                periode_kp: dbFetchedMap[key].periode_kp || calculatePeriodeKP(dbFetchedMap[key].tgl_pengiriman_kelayanan), 
                ...dbFetchedMap[key] 
            }))
            .filter(item => {
                const golBaru = item.gol_tmt_baru || item.golongan_ruang || '';
                const golLama = item.gol_tmt_lama || '';
                // Jika mengandung IV/c, abaikan dari awal (tidak dihitung di totalDbCount maupun displayedCount)
                return !isGolonganIVc(golBaru) && !isGolonganIVc(golLama);
            });
        
        const sInst = document.getElementById('filterInstansi')?.value;
        const sPer = document.getElementById('filterPeriodeKP')?.value;
        const sKat = document.getElementById('filterKategori')?.value;
        const sJen = document.getElementById('filterJenisKP')?.value;
        
        let filtered = combinedDataList.filter(item => {
            if (typeof window.isEligibleForApp === 'function' && !window.isEligibleForApp(item)) return false;
            return (!sInst || item.instansi_induk === sInst) && 
                   (!sPer || item.periode_kp === sPer) && 
                   (!sKat || item.kategori_status === sKat) && 
                   (!sJen || (typeof formatJenisKP === 'function' ? formatJenisKP(item.jenis_kp) : item.jenis_kp) === sJen);
        });
            
        // Sekarang angka yang dihitung sudah murni tanpa data IV/c
        if (document.getElementById('displayedCount')) {
            document.getElementById('displayedCount').innerText = filtered.length;
        }
        if (document.getElementById('totalDbCount')) {
            const totalEligible = combinedDataList.filter(i => typeof window.isEligibleForApp === 'function' ? window.isEligibleForApp(i) : true).length;
            document.getElementById('totalDbCount').innerText = totalEligible;
        }
        
        sortDataList(filtered, currentSortColumn, isAscending);
        if (typeof window.updateDashboardMetrics === 'function') {
            window.updateDashboardMetrics(); 
        }
    }
}


// Helper untuk mendeteksi variasi penulisan "IV c"
// Helper yang tangguh untuk mendeteksi Golongan IV/c (termasuk jika ada TMT/tanggal di dalamnya)
function isGolonganIVc(val) {
    if (!val || val === '--') return false;
    const str = String(val).toLowerCase();
    
    // Mengecek apakah string mengandung 'iv/c', 'iv c', 'iv.c', atau dimulai dengan 'ivc'
    return str.includes('iv/c') || 
           str.includes('iv c') || 
           str.includes('iv.c') || 
           /\bivc\b/.test(str);
}

function renderAllTableRows(dataList) {
    const tbody = document.getElementById('tableBody'); 
    if(!tbody) return; 
    tbody.innerHTML = '';
    
    if (typeof isFirstDbLoad !== 'undefined' && isFirstDbLoad) { 
        tbody.innerHTML = `<tr><td colspan="16"><div class="table-loading-overlay"><div class="table-spinner"></div>Memuat data...</div></td></tr>`; 
        return; 
    }

    // FILTER PENGECEKAN: Buang/Abaikan baris yang memiliki IV/c pada golongan baru maupun lama
    const validDataList = (dataList || []).filter(rec => {
        const golBaru = rec.gol_tmt_baru || rec.golongan_ruang || '';
        const golLama = rec.gol_tmt_lama || '';
        
        // Jika terdeteksi IV/c, kecualikan dari tabel
        if (isGolonganIVc(golBaru) || isGolonganIVc(golLama)) {
            return false;
        }
        return true;
    });

    if (validDataList.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; color: #7f8c8d; padding: 20px;">Belum ada data tersedia di database.</td></tr>`; 
        return; 
    }
    
    validDataList.forEach(rec => {
        const tr = document.createElement('tr');
        if (rec.kategori_status === 'BTS') tr.classList.add('row-bts'); 
        else if (rec.kategori_status === 'TMS') tr.classList.add('row-tms');
        
        const uInit = (rec.uploader_initial && rec.uploader_initial !== '--') ? String(rec.uploader_initial).toUpperCase() : 'OP';
        const c = (typeof getColorForInitial === 'function') ? getColorForInitial(uInit) : { bg: '#334155', color: '#fff' };
        
        const isKpo = (typeof window.checkIsKPO === 'function') ? window.checkIsKPO(rec) : false;
        const kpoBadge = isKpo ? `<span style="background-color: #8b5cf6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 7px; font-weight: bold; margin-left: 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); vertical-align: middle;">KPO</span>` : '';
        
        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="row-checkbox" data-key="${rec.dbKey}" ${selectedDbKeys.has(rec.dbKey) ? 'checked' : ''}></td>
            <td style="text-align: center;"><span class="id-initial-badge" style="background-color: ${c.bg}; color: ${c.color};" title="Waktu Simpan DB: ${typeof formatDateTime === 'function' ? formatDateTime(rec.uploaded_at) : ''}">${uInit}</span></td>
            <td>${typeof cleanInstansiName === 'function' ? cleanInstansiName(rec.instansi_induk) : (rec.instansi_induk || '-')}</td>
            <td>${normalizeValue(rec.tgl_pengiriman_kelayanan)}</td>
            <td><strong>${normalizeValue(rec.periode_kp)}</strong></td>
            <td>${normalizeValue(rec.status_usulan)}</td>
            <td><strong>${normalizeValue(rec.kategori_status)}</strong><br>${kpoBadge}</td>
            <td>${normalizeValue(rec.tgl_pertek)}</td>
            <td>${normalizeValue(rec.no_pertek)}</td>
            <td>${normalizeValue(rec.nama)}</td>
            <td>${normalizeValue(rec.nip)}</td>
            <td>${normalizeValue(rec.gol_tmt_lama)}</td>
            <td>${normalizeValue(rec.gol_tmt_baru)}</td>
            <td>${normalizeValue(rec.jenis_prosedur)}</td>
            <td>${typeof formatJenisKP === 'function' ? formatJenisKP(rec.jenis_kp) : (rec.jenis_kp || '-')}</td>
            <td style="text-align: center;"><button class="btn-preview" onclick="showPreviewModal('${rec.dbKey}')"><i class="fas fa-eye"></i></button></td>
        `;
        tbody.appendChild(tr);
    }); 
    if (typeof attachCheckboxListeners === 'function') attachCheckboxListeners();
}


// ==========================================
// HELPER PEMBAKUAN NAMA INSTANSI
// ==========================================
function standardizeInstansiName(name) {
    let norm = normalizeValue(name);
    if (norm === '--') return '--';

    norm = norm.replace(/^Pemerintah\s+/i, '').trim();

    const rawLower = norm.toLowerCase();
    
    if (rawLower.includes('maybrat')) return 'Kab. Maybrat';
    if (rawLower.includes('raja ampat')) return 'Kab. Raja Ampat';
    if (rawLower.includes('tambrauw')) return 'Kab. Tambrauw';
    if (rawLower.includes('sorong selatan') || rawLower.includes('sorsel')) return 'Kab. Sorong Selatan';
    if (rawLower.includes('kota sorong')) return 'Kota Sorong';
    if (rawLower === 'kab. sorong' || rawLower === 'kabupaten sorong' || rawLower === 'sorong') return 'Kab. Sorong';
    if (rawLower.includes('fak-fak') || rawLower.includes('fakfak')) return 'Kab. Fak-Fak';
    if (rawLower.includes('kaimana')) return 'Kab. Kaimana';
    if (rawLower.includes('teluk wondama') || rawLower.includes('wondama')) return 'Kab. Teluk Wondama';
    if (rawLower.includes('teluk bintuni') || rawLower.includes('bintuni')) return 'Kab. Teluk Bintuni';
    if (rawLower.includes('manokwari selatan') || rawLower.includes('mansel')) return 'Kab. Manokwari Selatan';
    if (rawLower.includes('pegunungan arfak') || rawLower.includes('pegaf')) return 'Kab. Pegunungan Arfak';
    if (rawLower === 'kab. manokwari' || rawLower === 'kabupaten manokwari' || rawLower === 'manokwari') return 'Kab. Manokwari';
    
    if (rawLower.includes('papua barat daya') || rawLower.includes('daya')) return 'Prov. Papua Barat Daya';
    if (rawLower.includes('papua barat')|| rawLower.includes('pabar')) return 'Prov. Papua Barat';

    return norm.toLowerCase().split(' ').map(word => {
        if (!word) return '';
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

// ==========================================
// RENDER TABEL PI
// ==========================================
function renderTablePI(dataList) {
    const tbody = document.getElementById('tableBodyPI'); 
    if (!tbody) return; 
    tbody.innerHTML = '';
    
    if (typeof isFirstDbLoad !== 'undefined' && isFirstDbLoad) { 
        tbody.innerHTML = `<tr><td colspan="12"><div class="table-loading-overlay"><div class="table-spinner"></div>Memuat data PI...</div></td></tr>`; 
        return; 
    }
    
    if (dataList.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; color: #7f8c8d; padding: 20px;">Belum ada data PI yang sesuai filter.</td></tr>`; 
        return; 
    }

    const totalData = dataList.length;
    
    dataList.forEach((rec, idx) => {
        const tr = document.createElement('tr');
        if (rec.status === 'TMS') tr.classList.add('row-tms'); 
        else if (rec.status === 'BTS') tr.classList.add('row-bts');
        
        const uInit = (rec.uploader_initial && rec.uploader_initial !== '--') ? String(rec.uploader_initial).toUpperCase() : 'OP';
        const c = (typeof getColorForInitial === 'function') ? getColorForInitial(uInit) : { bg: '#334155', color: '#fff' };
        
        const instAsalBaku = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(rec.instansi_asal) : (rec.instansi_asal || '-');
        const instTujuanBaku = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(rec.instansi_tujuan) : (rec.instansi_tujuan || '-');

        const wilkerAuto = (typeof window.getAutomaticWilker === 'function')
            ? window.getAutomaticWilker(instAsalBaku, instTujuanBaku)
            : (rec.wilker_prov || '-');

        let wilkerBadgeClass = 'badge-wilker-vertikal';
        if (wilkerAuto === 'Papua Barat') {
            wilkerBadgeClass = 'badge-wilker-pb';
        } else if (wilkerAuto === 'Papua Barat Daya') {
            wilkerBadgeClass = 'badge-wilker-pbd';
        }

        // RUMUS NO DESCENDING (ANGKA TERAKHIR PADA BARIS PERTAMA)
        const noDescending = totalData - idx;

        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="row-checkbox-pi" data-key="${rec.dbKey}"></td>
            <!-- NO DESCENDING -->
            <td style="text-align: center; font-weight: bold;">${noDescending}</td>
            <td style="text-align: center;"><span class="id-initial-badge" style="background-color: ${c.bg}; color: ${c.color};" title="Diunggah: ${typeof formatDateTime === 'function' ? formatDateTime(rec.uploaded_at) : ''}">${uInit}</span></td>
            <td style="text-align: center; font-size: 10px;">${rec.tgl_validasi || '-'}</td>
            <td><strong>${rec.nama || '-'}</strong></td>
            <!-- KOLOM NIP -->
            <td style="font-family:helvetica; font-size: 12px;">${rec.nip || '-'}</td>
            <td>${instAsalBaku}</td>
            <td><strong>${instTujuanBaku}</strong></td>
            <td style="text-align: center;">
                <span class="badge-wilker ${wilkerBadgeClass}">
                    ${wilkerAuto}
                </span>
            </td>
            <td style="text-align: center;"><strong>${rec.status || '-'}</strong></td>
            <td>${rec.keterangan || '-'}</td>
            <td style="text-align: center;">
                <button class="btn-edit-animated" onclick="editRecordPI('${rec.dbKey}')" title="Edit Data">
                    <i class="fas fa-pen-to-square"></i> <span>Edit</span>
                </button>
            </td>
        `; 
        tbody.appendChild(tr);
    }); 

    if (typeof attachCheckboxListenersPI === 'function') attachCheckboxListenersPI();
}

// ==========================================
// RIWAYAT ACTION PI & UNDO LOGIC
// ==========================================
let piEditHistoryStack = []; 
const MAX_UNDO_STATES = 5;

function pushPiActionState(actionType, recordsArray) {
    if (piEditHistoryStack.length >= MAX_UNDO_STATES) {
        piEditHistoryStack.shift();
    }
    
    piEditHistoryStack.push({
        type: actionType,
        timestamp: new Date().toISOString(),
        items: JSON.parse(JSON.stringify(recordsArray)) 
    });
    
    updatePiUndoButtonUI();
}

function updatePiUndoButtonUI() {
    const btnUndo = document.getElementById('btnUndoEditPI');
    if (btnUndo) {
        const hasHistory = piEditHistoryStack.length > 0;
        btnUndo.disabled = !hasHistory;
        btnUndo.style.opacity = hasHistory ? '1' : '0.5';
        btnUndo.style.cursor = hasHistory ? 'pointer' : 'not-allowed';
        
        if (hasHistory) {
            const lastAction = piEditHistoryStack[piEditHistoryStack.length - 1];
            const actionLabel = lastAction.type === 'DELETE' ? 'Penghapusan' : 'Pengeditan';
            btnUndo.title = `Undo ${actionLabel} (${piEditHistoryStack.length} riwayat tersimpan)`;
        } else {
            btnUndo.title = 'Tidak ada riwayat undo';
        }
    }
}

window.undoLastPIChange = async function() {
    if (!piEditHistoryStack || piEditHistoryStack.length === 0) {
        alert("⚠️ Tidak ada riwayat perubahan/penghapusan yang dapat di-undo.");
        return;
    }

    const lastState = piEditHistoryStack[piEditHistoryStack.length - 1];
    if (!lastState || !Array.isArray(lastState.items) || lastState.items.length === 0) {
        piEditHistoryStack.pop();
        updatePiUndoButtonUI();
        alert("⚠️ Riwayat undo tidak valid atau kosong.");
        return;
    }

    const isDeleteAction = (lastState.type === 'DELETE');
    const firstItemData = lastState.items[0]?.data || {};
    const targetName = firstItemData.nama || 'Pegawai';
    
    const actionNameText = isDeleteAction 
        ? `MENGEMBALIKAN ${lastState.items.length} data yang telah dihapus` 
        : `MENGEMBALIKAN perubahan data "${targetName}"`;

    const confirmRestore = confirm(`↩️ UNDO KONFIRMASI:\nApakah Anda yakin ingin ${actionNameText}?\n\n(Tersisa ${piEditHistoryStack.length} riwayat tersimpan)`);

    if (!confirmRestore) return;

    const btnUndo = document.getElementById('btnUndoEditPI');
    if (btnUndo) {
        btnUndo.disabled = true;
        btnUndo.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
    }

    try {
        if (isDeleteAction) {
            const restorePromises = lastState.items.map(item => {
                if (!item.dbKey || !item.data) return Promise.resolve();
                return set(ref(db, `${MODULE_CONFIG['PI'].node}/${item.dbKey}`), item.data);
            });
            await Promise.all(restorePromises);
            alert(`✅ Berhasil mengembalikan ${lastState.items.length} data PI yang dihapus!`);
        } else {
            const itemToRestore = lastState.items[0];
            if (itemToRestore && itemToRestore.dbKey && itemToRestore.data) {
                await update(ref(db, `${MODULE_CONFIG['PI'].node}/${itemToRestore.dbKey}`), itemToRestore.data);
                alert("✅ Berhasil mengembalikan (undo) perubahan data edit!");
                
                const currentActiveKey = document.getElementById('editKeyPI')?.value;
                if (currentActiveKey === itemToRestore.dbKey && typeof editRecordPI === 'function') {
                    editRecordPI(itemToRestore.dbKey);
                }
            }
        }
        piEditHistoryStack.pop();
    } catch (err) {
        alert("❌ Gagal melakukan undo: " + err.message);
    } finally {
        if (btnUndo) {
            btnUndo.innerHTML = '<i class="fas fa-rotate-left"></i> Undo';
        }
        updatePiUndoButtonUI();
    }
};

// ==========================================
// FORM EDIT / TAMBAH PI DUAL-MODE
// ==========================================
// =======================================================
// FUNGSI MEMBUKA FORM DALAM MODE TAMBAH
// =======================================================
window.openAddFormPI = function() {
    window.closeEditFormPI(); // Reset seluruh input & state terlebih dahulu

    const titleText = document.getElementById('sideFormTitleTextPI');
    if (titleText) titleText.innerText = 'Tambah Data PI Baru';

    const sideForm = document.getElementById('sideEditFormPI');
    if (sideForm) sideForm.style.display = 'block';

    if (typeof updatePiUndoButtonUI === 'function') {
        updatePiUndoButtonUI();
    }
};

// =======================================================
// FUNGSI MEMBUKA FORM DALAM MODE EDIT (SESUAI KEY DATABASE)
// =======================================================
window.editRecordPI = function(dbKey) {
    const item = (typeof dbFetchedMap !== 'undefined' && dbFetchedMap) ? dbFetchedMap[dbKey] : null;
    if (!item) return alert("❌ Data tidak ditemukan.");

    window.closeEditFormPI(); // Reset state sebelum mengisikan data baru

    // Mapping Status: Jika status awal 'MS', otomatis ubah ke 'ACC'
    let statusValue = (item.status || 'INBOX').toUpperCase().trim();
    if (statusValue === 'MS') {
        statusValue = 'ACC';
    }
    // Isikan nilai data ke elemen input (Menggunakan penanganan aman untuk editNipPI)
    const keyEl = document.getElementById('editKeyPI');
    if (keyEl) keyEl.value = dbKey;

    const namaEl = document.getElementById('editNamaPI');
    if (namaEl) namaEl.value = item.nama || '';

    const nipEl = document.getElementById('editNipPI');
    if (nipEl) nipEl.value = item.nip || ''; // Tetap aman jika elemen belum ada di HTML

    const asalEl = document.getElementById('editInstansiAsalPI');
    if (asalEl) asalEl.value = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(item.instansi_asal || '') : (item.instansi_asal || '');

    const tujuanEl = document.getElementById('editInstansiTujuanPI');
    if (tujuanEl) tujuanEl.value = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(item.instansi_tujuan || '') : (item.instansi_tujuan || '');

    const tglEl = document.getElementById('editTglValidasiPI');
    if (tglEl) tglEl.value = item.tgl_validasi || '';

    // Set nilai status ke dropdown
    const statusEl = document.getElementById('editStatusPI');
    if (statusEl) statusEl.value = statusValue;

    const ketEl = document.getElementById('editKeteranganPI');
    if (ketEl) ketEl.value = item.keterangan || '';

    // Ubah Judul & Tampilkan Side Panel Form PI
    const titleText = document.getElementById('sideFormTitleTextPI');
    if (titleText) titleText.innerText = 'Edit Data PI';

    const sideForm = document.getElementById('sideEditFormPI');
    if (sideForm) sideForm.style.display = 'block';

    if (typeof updatePiUndoButtonUI === 'function') {
        updatePiUndoButtonUI();
    }
    
    // Smooth scroll otomatis ke arah form jika layar beresolusi kecil
    sideForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

// =======================================================
// FUNGSI MENUTUP FORM SIDE PANEL PI
// =======================================================
window.closeEditFormPI = function() {
    const sideForm = document.getElementById('sideEditFormPI');
    if (sideForm) sideForm.style.display = 'none';

    const formEl = document.getElementById('formEditPI');
    if (formEl) formEl.reset();

    const keyEl = document.getElementById('editKeyPI');
    if (keyEl) keyEl.value = '';
};

// =======================================================
// EVENT LISTENER SUBMIT FORM (TAMBAH / UPDATE FIREBASE)
// =======================================================
document.getElementById('formEditPI')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dbKey = document.getElementById('editKeyPI')?.value.trim() || '';

    const rawAsal = document.getElementById('editInstansiAsalPI')?.value || '';
    const rawTujuan = document.getElementById('editInstansiTujuanPI')?.value || '';

    const instansiAsalClean = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(rawAsal) : rawAsal;
    const instansiTujuanClean = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(rawTujuan) : rawTujuan;

    const calculatedWilker = (typeof window.getAutomaticWilker === 'function') 
        ? window.getAutomaticWilker(instansiAsalClean, instansiTujuanClean) 
        : 'Instansi Vertikal';

    const recordPayload = {
        nama: document.getElementById('editNamaPI')?.value.trim() || '',
        nip: document.getElementById('editNipPI')?.value.trim() || '', // Ambil nilai NIP
        instansi_asal: instansiAsalClean,
        instansi_tujuan: instansiTujuanClean,
        wilker_prov: calculatedWilker,
        tgl_validasi: document.getElementById('editTglValidasiPI')?.value.trim() || '',
        status: document.getElementById('editStatusPI')?.value.trim().toUpperCase() || 'INBOX',
        keterangan: document.getElementById('editKeteranganPI')?.value.trim() || '',
        uploader_initial: (typeof currentUserInitial !== 'undefined' && currentUserInitial !== '--') ? currentUserInitial : 'OP',
        uploaded_at: new Date().toISOString()
    };

    try {
        if (dbKey) {
            const oldRecord = (typeof dbFetchedMap !== 'undefined') ? dbFetchedMap[dbKey] : null;
            if (oldRecord && typeof pushPiActionState === 'function') {
                pushPiActionState('EDIT', [{ dbKey: dbKey, data: { ...oldRecord } }]);
            }
            await update(ref(db, `${MODULE_CONFIG['PI'].node}/${dbKey}`), recordPayload);
            alert("✅ Data Pindah Instansi berhasil diperbarui!");
        } else {
            await push(ref(db, MODULE_CONFIG['PI'].node), recordPayload);
            alert("✅ Data Pindah Instansi baru berhasil ditambahkan!");
        }
        window.closeEditFormPI();
    } catch (err) {
        alert("❌ Gagal menyimpan data: " + err.message);
    }
});

// =======================================================
// 1. LOGIKA PENENTUAN WILKER OTOMATIS BERDASARKAN INSTANSI TUJUAN
// =======================================================
window.getAutomaticWilker = function(instansiAsal, instansiTujuan) {
    // Penentuan wilker difokuskan HANYA dari instansi tujuan
    const cleanTujuan = (instansiTujuan || "").trim().toUpperCase();

    if (!cleanTujuan) return "Instansi Vertikal";

    // A. Cari kecocokan persis dari Master Data Instansi berdasarkan Instansi Tujuan
    const matchTujuan = masterInstansiData.find(item => item.name.toUpperCase() === cleanTujuan);
    if (matchTujuan) return matchTujuan.wilker;

    // B. Logika Cadangan Berdasarkan Kata Kunci Nama Instansi Tujuan
    const pbKeywords = ["MANOKWARI", "BINTUNI", "WONDAMA", "KAIMANA", "FAK-FAK", "PAPUA BARAT"];
    const pbdKeywords = ["SORONG", "RAJA AMPAT", "TAMBRAUW", "MAYBRAT", "PAPUA BARAT DAYA"];

    // Cek Papua Barat Daya terlebih dahulu (agar tidak bentrok dengan kata "PAPUA BARAT")
    if (cleanTujuan.includes("PAPUA BARAT DAYA") || pbdKeywords.some(kw => cleanTujuan.includes(kw))) {
        return "Papua Barat Daya";
    }

    // Cek Papua Barat
    if (pbKeywords.some(kw => cleanTujuan.includes(kw))) {
        return "Papua Barat";
    }

    // Default jika tidak cocok dengan instansi daerah di atas
    return "Instansi Vertikal";
};

// =======================================================
// 2. PENYESUAIAN PADA EVENT LISTENER SUBMIT FORM PI
// =======================================================
document.getElementById('formEditPI')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dbKey = document.getElementById('editKeyPI').value.trim();

    const rawAsal = document.getElementById('editInstansiAsalPI').value;
    const rawTujuan = document.getElementById('editInstansiTujuanPI').value;

    const instansiAsalClean = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(rawAsal) : rawAsal;
    const instansiTujuanClean = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(rawTujuan) : rawTujuan;

    // Wilker dihitung MURNI mengacu pada Instansi Tujuan
    const calculatedWilker = window.getAutomaticWilker(instansiAsalClean, instansiTujuanClean);

    const recordPayload = {
        nama: document.getElementById('editNamaPI').value.trim(),
        instansi_asal: instansiAsalClean,
        instansi_tujuan: instansiTujuanClean,
        wilker_prov: calculatedWilker, // Otomatis terisi dari Instansi Tujuan
        tgl_validasi: document.getElementById('editTglValidasiPI').value.trim(),
        status: document.getElementById('editStatusPI').value.trim().toUpperCase(),
        keterangan: document.getElementById('editKeteranganPI').value.trim(),
        uploader_initial: (typeof currentUserInitial !== 'undefined' && currentUserInitial !== '--') ? currentUserInitial : 'OP',
        uploaded_at: new Date().toISOString()
    };

    try {
        if (dbKey) {
            const oldRecord = dbFetchedMap[dbKey];
            if (oldRecord && typeof pushPiActionState === 'function') {
                pushPiActionState('EDIT', [{ dbKey: dbKey, data: { ...oldRecord } }]);
            }
            await update(ref(db, `${MODULE_CONFIG['PI'].node}/${dbKey}`), recordPayload);
            alert("✅ Data Pindah Instansi berhasil diperbarui!");
        } else {
            await push(ref(db, MODULE_CONFIG['PI'].node), recordPayload);
            alert("✅ Data Pindah Instansi baru berhasil ditambahkan!");
        }
        window.closeEditFormPI();
    } catch (err) {
        alert("❌ Gagal menyimpan data: " + err.message);
    }
});

// SORT PI
let currentSortColumnPI = 'tgl_validasi', isAscendingPI = false; 

window.sortTablePI = function(columnName) { 
    if (currentSortColumnPI === columnName) { 
        isAscendingPI = !isAscendingPI; 
    } else { 
        currentSortColumnPI = columnName; 
        isAscendingPI = (columnName === 'nama' || columnName === 'instansi_asal'); 
    } 
    
    ['nama', 'instansi_asal', 'instansi_tujuan', 'wilker_prov', 'tgl_validasi', 'status'].forEach(col => { 
        const el = document.getElementById(`sort_pi_${col}`); 
        if (el) el.innerText = '↕'; 
    }); 
    
    const activeArrow = document.getElementById(`sort_pi_${currentSortColumnPI}`); 
    if (activeArrow) activeArrow.innerText = isAscendingPI ? '▲' : '▼'; 
    refreshAllDisplays(); 
};

function sortDataListPI(dataList) { 
    dataList.sort((a, b) => { 
        let valA = a[currentSortColumnPI] || '--'; 
        let valB = b[currentSortColumnPI] || '--'; 
        
        if (currentSortColumnPI === 'tgl_validasi') { 
            valA = (valA === '--') ? new Date(0) : new Date(valA); 
            valB = (valB === '--') ? new Date(0) : new Date(valB); 
        } 
        
        if (valA < valB) return isAscendingPI ? -1 : 1; 
        if (valA > valB) return isAscendingPI ? 1 : -1; 
        return 0; 
    }); 
}

// SORT KP
function sortDataList(dataList, col, asc) {
    dataList.sort((a, b) => {
        let vA = a[col] || '--', vB = b[col] || '--';
        if (col === 'tgl_pengiriman_kelayanan' || col === 'tgl_pertek') { 
            vA = vA === '--' ? new Date(0) : new Date(vA); 
            vB = vB === '--' ? new Date(0) : new Date(vB); 
        }
        if (vA < vB) return asc ? -1 : 1; 
        if (vA > vB) return asc ? 1 : -1; 
        return 0;
    }); 
    renderAllTableRows(dataList);
}

window.sortTable = function(columnName) { 
    currentSortColumn = (currentSortColumn === columnName) ? columnName : columnName; 
    isAscending = (currentSortColumn === columnName) ? !isAscending : true; 
    
    document.querySelectorAll('.sort-arrow').forEach(el => el.innerText = '↕'); 
    if (document.getElementById(`sort_${currentSortColumn}`)) {
        document.getElementById(`sort_${currentSortColumn}`).innerText = isAscending ? '▲' : '▼'; 
    }
    refreshAllDisplays(); 
};

// Event Listener Tabel KP & PI Filters
['filterInstansi', 'filterPeriodeKP', 'filterKategori', 'filterJenisKP', 'filterInstansiAsalPI', 'filterInstansiTujuanPI', 'filterWilkerPI', 'filterStatusPI'].forEach(id => {
    const el = document.getElementById(id); 
    if (el) el.addEventListener('change', refreshAllDisplays);
});


if(document.getElementById('btnToggleKabChart')) { 
    document.getElementById('btnToggleKabChart').addEventListener('click', () => { 
        const w = document.getElementById('kabChartWrapper'), b = document.getElementById('btnToggleKabChart'); 
        if (w.style.display === 'none') { 
            w.style.display = 'block'; 
            b.innerText = '🙈 Sembunyikan Grafik Donat Detail'; 
        } else { 
            w.style.display = 'none'; 
            b.innerText = '🍩 Tampilkan Grafik Donat Detail'; 
        } 
    }); 
}

// ==========================================
// 7. FORM UPLOAD & DRAG DROP
// ==========================================
function setupToggleUploadForm() {
    const btnKP = document.getElementById('btnToggleUploadForm'), wrapperKP = document.getElementById('uploadFormWrapper');
    if (btnKP && wrapperKP) { 
        btnKP.addEventListener('click', () => { 
            wrapperKP.style.display = wrapperKP.style.display === 'none' ? 'block' : 'none'; 
            document.getElementById('toggleIcon').innerHTML = wrapperKP.style.display === 'none' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>'; 
            document.getElementById('toggleText').innerText = wrapperKP.style.display === 'none' ? 'Tampilkan Form KP' : 'Sembunyikan Form KP'; 
        }); 
    }
    
    const btnPI = document.getElementById('btnToggleUploadFormPI'), wrapperPI = document.getElementById('uploadFormWrapperPI');
    if (btnPI && wrapperPI) { 
        btnPI.addEventListener('click', () => { 
            wrapperPI.style.display = wrapperPI.style.display === 'none' ? 'block' : 'none'; 
            document.getElementById('toggleIconPI').innerHTML = wrapperPI.style.display === 'none' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>'; 
            document.getElementById('toggleTextPI').innerText = wrapperPI.style.display === 'none' ? 'Tampilkan Form PI' : 'Sembunyikan Form PI'; 
        }); 
    }
}

function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone'), fileInput = document.getElementById('uploadKP'); 
    if(!dropZone || !fileInput) return;
    
    dropZone.addEventListener('click', () => fileInput.click()); 
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, evt => { evt.preventDefault(); evt.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('dragover'))); 
    ['dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('dragover')));
    
    dropZone.addEventListener('drop', e => handleNewFiles(Array.from(e.dataTransfer.files))); 
    fileInput.addEventListener('change', e => { handleNewFiles(Array.from(e.target.files)); e.target.value = ''; });
}

function setupDragAndDropPI() {
    const dropZone = document.getElementById('dropZonePI'), fileInput = document.getElementById('uploadPI'); 
    if(!dropZone || !fileInput) return;
    
    dropZone.addEventListener('click', () => fileInput.click()); 
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, evt => { evt.preventDefault(); evt.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('dragover'))); 
    ['dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('dragover')));
    
    dropZone.addEventListener('drop', e => handleNewFilesPI(Array.from(e.dataTransfer.files))); 
    fileInput.addEventListener('change', e => { handleNewFilesPI(Array.from(e.target.files)); e.target.value = ''; });
}

async function handleNewFiles(files) {
    if (files.length === 0) return;
    for (let file of files) {
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const buffer = await file.arrayBuffer(); 
            const rows = XLSX.utils.sheet_to_json(XLSX.read(buffer, { type: 'array' }).Sheets[XLSX.read(buffer, { type: 'array' }).SheetNames[0]], { header: 1 });
            if (!isValidExcelStructure(rows)) { 
                alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" ditolak karena KOSONG atau format Excel tidak sesuai.`); 
                continue; 
            }
            if (!selectedFilesQueue.some(f => f.name === file.name && f.size === file.size)) selectedFilesQueue.push(file);
        } else { 
            alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" bukan Excel.`); 
        }
    }
    renderFileQueueUI();
}

async function handleNewFilesPI(files) {
    if (files.length === 0) return;
    for (let file of files) {
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const buffer = await file.arrayBuffer(); 
            const rows = XLSX.utils.sheet_to_json(XLSX.read(buffer, { type: 'array' }).Sheets[XLSX.read(buffer, { type: 'array' }).SheetNames[0]], { header: 1 });
            if (!isValidExcelStructurePI(rows)) { 
                alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" tidak sesuai struktur PI.`); 
                continue; 
            }
            if (!selectedFilesQueuePI.some(f => f.name === file.name && f.size === file.size)) selectedFilesQueuePI.push(file);
        } else { 
            alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" bukan Excel.`); 
        }
    }
    renderFileQueueUIPI();
}

function renderFileQueueUI() {
    const queueCard = document.getElementById('fileQueueCard'), container = document.getElementById('fileListContainer'); 
    if (!queueCard || !container) return;
    
    if (selectedFilesQueue.length === 0) { queueCard.style.display = 'none'; return; }
    
    queueCard.style.display = 'block'; 
    document.getElementById('fileCountText').innerText = selectedFilesQueue.length; 
    container.innerHTML = '';
    
    selectedFilesQueue.forEach((file, index) => { 
        const d = document.createElement('div'); 
        d.className = 'file-item'; 
        d.innerHTML = `<div class="file-info"><span>📊</span><span class="file-name">${file.name}</span><span class="file-size">(${formatFileSize(file.size)})</span></div><button class="btn-remove-file" onclick="removeFileFromQueue(${index})">❌</button>`; 
        container.appendChild(d); 
    });
}

function renderFileQueueUIPI() {
    const queueCard = document.getElementById('fileQueueCardPI'), container = document.getElementById('fileListContainerPI'); 
    if (!queueCard || !container) return;
    
    if (selectedFilesQueuePI.length === 0) { queueCard.style.display = 'none'; return; }
    
    queueCard.style.display = 'block'; 
    document.getElementById('fileCountTextPI').innerText = selectedFilesQueuePI.length; 
    container.innerHTML = '';
    
    selectedFilesQueuePI.forEach((file, index) => { 
        const d = document.createElement('div'); 
        d.className = 'file-item'; 
        d.innerHTML = `<div class="file-info"><span>📊</span><span class="file-name">${file.name}</span><span class="file-size">(${formatFileSize(file.size)})</span></div><button class="btn-remove-file" onclick="removeFileFromQueuePI(${index})">❌</button>`; 
        container.appendChild(d); 
    });
}

window.removeFileFromQueue = function(index) { 
    selectedFilesQueue.splice(index, 1); 
    renderFileQueueUI(); 
}; 

window.removeFileFromQueuePI = function(index) { 
    selectedFilesQueuePI.splice(index, 1); 
    renderFileQueueUIPI(); 
};

// UPLOAD ACTION KP
document.getElementById('btnUploadDB')?.addEventListener('click', async () => {
    if (selectedFilesQueue.length === 0) return;
    
    const activeNode = MODULE_CONFIG[currentModule].node; 
    previousDbSnapshot = JSON.parse(JSON.stringify(dbFetchedMap)); 
    updateUndoButtonUI();
    
    const modal = document.getElementById('uploadProgressModal'), 
          fill = document.getElementById('progressBarFill'), 
          percentTxt = document.getElementById('progressPercent'), 
          subTxt = document.getElementById('progressSubDetail');
          
    modal.style.display = 'flex'; 
    fill.style.width = '0%'; 
    percentTxt.innerText = '0%';
    
    let parsedRecords = [];
    for (let fIdx = 0; fIdx < selectedFilesQueue.length; fIdx++) {
        const rows = XLSX.utils.sheet_to_json(XLSX.read(await selectedFilesQueue[fIdx].arrayBuffer(), { type: 'array' }).Sheets[XLSX.read(await selectedFilesQueue[fIdx].arrayBuffer(), { type: 'array' }).SheetNames[0]], { header: 1 });
        
        for (let i = 3; i < rows.length; i++) {
            const row = rows[i]; if (!row || !row[0]) continue;
            const tglUsul = formatTanggal(row[5]), rawStatus = normalizeValue(row[6]);
            parsedRecords.push({ 
                uploaded_at: new Date().toISOString(), uploader_initial: (currentUserInitial !== '--') ? currentUserInitial : 'OP', 
                source_file: selectedFilesQueue[fIdx].name, instansi_induk: normalizeValue(row[0]), instansi_kerja: normalizeValue(row[1]), 
                unor_nama: normalizeValue(row[2]), unor_induk_nama: normalizeValue(row[3]), tgl_usulan: formatTanggal(row[4]), 
                tgl_pengiriman_kelayanan: tglUsul, periode_kp: calculatePeriodeKP(tglUsul), status_usulan: rawStatus, 
                kategori_status: categoriseStatus(rawStatus), no_pertek: normalizeValue(row[7]), tgl_pertek: formatTanggal(row[8]), 
                gelar_depan: normalizeValue(row[9]), gelar_belakang: normalizeValue(row[10]), nama: normalizeValue(row[11]), 
                nip: normalizeValue(row[12]), tempat_lahir: normalizeValue(row[13]), tgl_lahir: formatTanggal(row[14]), 
                pendidikan: row[15] ? `${row[15]} (${row[16] || ''})` : '--', gol_tmt_lama: `${normalizeValue(row[17])} / ${formatTanggal(row[18])}`, 
                pangkat_lama: normalizeValue(row[19]), jabatan_lama: normalizeValue(row[23]), gol_tmt_baru: `${normalizeValue(row[25])} / ${formatTanggal(row[26])}`, 
                pangkat_baru: normalizeValue(row[27]), jabatan_baru: normalizeValue(row[31]), no_sk: normalizeValue(row[33]), 
                tgl_sk: formatTanggal(row[34]), pejabat_ttd_pertek: normalizeValue(row[36]), kppn: normalizeValue(row[37]), 
                jenis_prosedur: normalizeValue(row[38]), jenis_kp: normalizeValue(row[39]), alasan_tolak: normalizeValue(row[40]), 
                verifikator_nip: normalizeValue(row[41]), verifikator_nama: normalizeValue(row[42]), kanreg_operator: normalizeValue(row[43]), 
                uraian_perbaikan_pertek_instansi: normalizeValue(row[44]), uraian_pembatalan_pertek_instansi: normalizeValue(row[45]), 
                tgl_ttd_pertek: formatTanggal(row[46]), status_kpo: normalizeValue(row[47]), raw_columns: row.map(c => normalizeValue(c)) 
            });
        }
    }
    
    if (parsedRecords.length === 0) { 
        modal.style.display = 'none'; 
        return alert('Data usulan kosong.'); 
    }
    
    const existingNipMap = {}; 
    Object.keys(dbFetchedMap).forEach(key => { 
        if (dbFetchedMap[key].nip !== '--') existingNipMap[dbFetchedMap[key].nip] = { key, record: dbFetchedMap[key] }; 
    });
    
    let dupes = parsedRecords.filter(item => existingNipMap[item.nip]).length;
    if (dupes > 0) { 
        modal.style.display = 'none'; 
        if (!confirm(`Terdapat ${dupes} NIP sama. Timpa data lama?`)) return; 
        modal.style.display = 'flex'; 
    }
    
    try {
        let count = 0;
        for (let rec of parsedRecords) {
            const ext = existingNipMap[rec.nip];
            if (ext && new Date(rec.tgl_pengiriman_kelayanan !== '--' ? rec.tgl_pengiriman_kelayanan : 0) >= new Date(ext.record.tgl_pengiriman_kelayanan !== '--' ? ext.record.tgl_pengiriman_kelayanan : 0)) {
                await update(ref(db, `${activeNode}/${ext.key}`), rec); 
            } else {
                await push(ref(db, activeNode), rec);
            }
            count++; 
            fill.style.width = `${Math.round((count / parsedRecords.length) * 100)}%`; 
            percentTxt.innerText = `${Math.round((count / parsedRecords.length) * 100)}%`; 
            subTxt.innerText = `${count} dari ${parsedRecords.length} data terkirim`;
        }
        setTimeout(() => { 
            modal.style.display = 'none'; 
            selectedFilesQueue = []; 
            renderFileQueueUI(); 
        }, 500);
    } catch (e) { 
        modal.style.display = 'none'; 
        alert(`Gagal Upload: ${e.message}`); 
    }
});

// UPLOAD ACTION PI
document.getElementById('btnUploadDBPI')?.addEventListener('click', async () => {
    if (selectedFilesQueuePI.length === 0) return; 
    const activeNode = MODULE_CONFIG['PI'].node;
    const modal = document.getElementById('uploadProgressModal'), 
          fill = document.getElementById('progressBarFill'), 
          percentTxt = document.getElementById('progressPercent'), 
          subTxt = document.getElementById('progressSubDetail'); 
    
    if (modal) modal.style.display = 'flex';
    
    let parsedRecords = [];
    
    for (let fIdx = 0; fIdx < selectedFilesQueuePI.length; fIdx++) {
        const file = selectedFilesQueuePI[fIdx];
        
        // Baca file buffer 1x untuk efisiensi
        const fileBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(fileBuffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        if (!isValidExcelStructurePI(rows)) { 
            if (modal) modal.style.display = 'none'; 
            alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" tidak sesuai struktur Pindah Instansi (PI).`); 
            return; 
        }
        
        // Loop baris data (Mulai baris ke-2 / index 1)
        // Struktur Excel:
        // row[0] = NO
        // row[1] = NAMA
        // row[2] = NIP
        // row[3] = INSTANSI ASAL
        // row[4] = INSTANSI TUJUAN
        // row[5] = WILKER (PROV)
        // row[6] = TANGGAL VALIDASI
        // row[7] = STATUS
        // row[8] = KETERANGAN / VALIDATOR
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i]; 
            if (!row || !row[1]) continue; // Lewati jika nama kosong
            
            const instAsalClean = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(row[3]) : normalizeValue(row[3]);
            const instTujuanClean = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(row[4]) : normalizeValue(row[4]);
            
            // Hitung wilker otomatis berbasis Instansi Tujuan (dengan fallback nilai dari Excel jika ada)
            const wilkerCalculated = (typeof window.getAutomaticWilker === 'function') 
                ? window.getAutomaticWilker(instAsalClean, instTujuanClean) 
                : normalizeValue(row[5]);

            parsedRecords.push({ 
                uploaded_at: new Date().toISOString(), 
                uploader_initial: (currentUserInitial !== '--') ? currentUserInitial : 'OP', 
                source_file: file.name, 
                nama: normalizeValue(row[1]), 
                nip: String(row[2] || '').replace(/'/g, '').trim(), // PERBAIKAN: Input NIP sebagai string bersih
                instansi_asal: instAsalClean, 
                instansi_tujuan: instTujuanClean, 
                wilker_prov: wilkerCalculated, 
                tgl_validasi: formatTanggal(row[6]), 
                status: normalizeValue(row[7]).toUpperCase(), 
                keterangan: normalizeValue(row[8]) 
            });
        }
    }
    
    if (parsedRecords.length === 0) { 
        if (modal) modal.style.display = 'none'; 
        alert('File Excel PI kosong atau tidak memiliki baris data valid.'); 
        return; 
    }
    
    try {
        let count = 0;
        for (let rec of parsedRecords) {
            await push(ref(db, activeNode), rec); 
            count++; 
            const progress = Math.round((count / parsedRecords.length) * 100);
            if (fill) fill.style.width = `${progress}%`; 
            if (percentTxt) percentTxt.innerText = `${progress}%`; 
            if (subTxt) subTxt.innerText = `${count} dari ${parsedRecords.length} baris terkirim`;
        }
        setTimeout(() => { 
            if (modal) modal.style.display = 'none'; 
            alert('✅ Berhasil mengunggah data Pindah Instansi ke Database!'); 
            selectedFilesQueuePI = []; 
            renderFileQueueUIPI(); 
        }, 500);
    } catch (e) { 
        if (modal) modal.style.display = 'none'; 
        alert(`Gagal Upload PI: ${e.message}`); 
    }
});

function updateUndoButtonUI() { 
    if(document.getElementById('btnUndo')) document.getElementById('btnUndo').style.display = previousDbSnapshot !== null ? 'inline-block' : 'none'; 
}

document.getElementById('btnUndo')?.addEventListener('click', async () => {
    if (!previousDbSnapshot || !confirm("Undo database?")) return;
    const btn = document.getElementById('btnUndo'); 
    btn.innerText = 'Proses...'; 
    btn.disabled = true;
    
    try { 
        await set(ref(db, MODULE_CONFIG[currentModule].node), previousDbSnapshot); 
        alert("Berhasil undo!"); 
        previousDbSnapshot = null; 
        updateUndoButtonUI(); 
    } catch (e) { 
        alert(`Gagal Undo: ${e.message}`); 
    } finally { 
        btn.innerText = '↩ Undo Perubahan'; 
        btn.disabled = false; 
    }
});

// Checkbox Management
function attachCheckboxListeners() {
    const sAll = document.getElementById('selectAll'), rowCbs = document.querySelectorAll('.row-checkbox');
    if(sAll) {
        sAll.onclick = () => { 
            rowCbs.forEach(cb => { 
                cb.checked = sAll.checked; 
                sAll.checked ? selectedDbKeys.add(cb.getAttribute('data-key')) : selectedDbKeys.delete(cb.getAttribute('data-key')); 
            }); 
            updateDeleteBtnUI(); 
        };
    }
    rowCbs.forEach(cb => {
        cb.onchange = function() { 
            this.checked ? selectedDbKeys.add(this.getAttribute('data-key')) : selectedDbKeys.delete(this.getAttribute('data-key')); 
            if(sAll) sAll.checked = rowCbs.length === selectedDbKeys.size; 
            updateDeleteBtnUI(); 
        };
    });
}

function attachCheckboxListenersPI() {
    const sAll = document.getElementById('selectAllPI'), rowCbs = document.querySelectorAll('.row-checkbox-pi');
    if (sAll) { 
        sAll.onclick = () => { 
            rowCbs.forEach(cb => { 
                cb.checked = sAll.checked; 
                const k = cb.getAttribute('data-key'); 
                if (k) { sAll.checked ? selectedDbKeys.add(k) : selectedDbKeys.delete(k); } 
            }); 
            updateDeleteBtnUI(); 
        }; 
    }
    rowCbs.forEach(cb => { 
        cb.onchange = function() { 
            const k = this.getAttribute('data-key'); 
            if (k) { this.checked ? selectedDbKeys.add(k) : selectedDbKeys.delete(k); } 
            if (sAll) sAll.checked = rowCbs.length === selectedDbKeys.size; 
            updateDeleteBtnUI(); 
        }; 
    });
}

function updateDeleteBtnUI() {
    if (document.getElementById('selectedCount')) document.getElementById('selectedCount').innerText = selectedDbKeys.size;
    if (document.getElementById('selectedCountPI')) document.getElementById('selectedCountPI').innerText = selectedDbKeys.size;
    
    const canDelete = (currentUserRole.toLowerCase() === 'admin') || currentUserAllowDelete;
    
    const btnDeleteKP = document.getElementById('btnDeleteSelected');
    if (btnDeleteKP) btnDeleteKP.style.display = (canDelete && currentModule === 'KP' && selectedDbKeys.size > 0) ? 'inline-block' : 'none';
    
    const btnDeletePI = document.getElementById('btnDeleteSelectedPI');
    if (btnDeletePI) btnDeletePI.style.display = (canDelete && currentModule === 'PI' && selectedDbKeys.size > 0) ? 'inline-block' : 'none';
}

document.getElementById('btnDeleteSelected')?.addEventListener('click', async () => {
    if (selectedDbKeys.size === 0 || !confirm(`Apakah Anda yakin ingin menghapus ${selectedDbKeys.size} data usulan KP yang dipilih?`)) return; 
    
    previousDbSnapshot = JSON.parse(JSON.stringify(dbFetchedMap)); 
    updateUndoButtonUI();
    document.getElementById('btnDeleteSelected').disabled = true;
    
    try { 
        await Promise.all(Array.from(selectedDbKeys).map(k => remove(ref(db, `${MODULE_CONFIG['KP'].node}/${k}`)))); 
        selectedDbKeys.clear(); 
        updateDeleteBtnUI(); 
        alert("✅ Data KP terpilih berhasil dihapus!");
    } catch (e) { 
        alert(`❌ Gagal menghapus data KP: ${e.message}`); 
    } finally { 
        document.getElementById('btnDeleteSelected').disabled = false; 
    }
});

document.getElementById('btnDeleteSelectedPI')?.addEventListener('click', async () => {
    if (selectedDbKeys.size === 0) {
        alert("⚠️ Silakan centang minimal satu data PI yang ingin dihapus.");
        return;
    }

    if (!confirm(`🗑️ Apakah Anda yakin ingin menghapus ${selectedDbKeys.size} data Pindah Instansi (PI) yang dipilih?`)) return; 

    const btn = document.getElementById('btnDeleteSelectedPI');
    btn.disabled = true;
    btn.innerText = 'Menghapus...';

    try { 
        const deletedItemsSnapshot = [];
        selectedDbKeys.forEach(key => {
            if (dbFetchedMap[key]) {
                deletedItemsSnapshot.push({
                    dbKey: key,
                    data: { ...dbFetchedMap[key] }
                });
            }
        });

        if (deletedItemsSnapshot.length > 0) {
            pushPiActionState('DELETE', deletedItemsSnapshot);
        }

        await Promise.all(Array.from(selectedDbKeys).map(k => remove(ref(db, `${MODULE_CONFIG['PI'].node}/${k}`)))); 
        
        selectedDbKeys.clear(); 
        if (document.getElementById('selectAllPI')) document.getElementById('selectAllPI').checked = false;
        
        updateDeleteBtnUI(); 
        alert("✅ Data Pindah Instansi terpilih berhasil dihapus!");
    } catch (e) { 
        alert(`❌ Gagal menghapus data PI: ${e.message}`); 
    } finally { 
        btn.disabled = false; 
        btn.innerHTML = '🗑️ Hapus Terpilih PI (<span id="selectedCountPI">0</span>)';
    }
});

window.showPreviewModal = function(dbKey) {
    const i = combinedDataList.find(x => x.dbKey === dbKey); 
    if (!i) {
        alert("⚠️ Data tidak ditemukan.");
        return;
    }

    if (document.getElementById('mNamaNip')) document.getElementById('mNamaNip').innerText = `${normalizeValue(i.nama)} (${normalizeValue(i.nip)})`;
    if (document.getElementById('mJabatanLama')) document.getElementById('mJabatanLama').innerText = normalizeValue(i.jabatan_lama); 
    if (document.getElementById('mJabatanBaru')) document.getElementById('mJabatanBaru').innerText = normalizeValue(i.jabatan_baru);
    if (document.getElementById('mPendidikan')) document.getElementById('mPendidikan').innerText = normalizeValue(i.pendidikan); 
    if (document.getElementById('mVerifikator')) document.getElementById('mVerifikator').innerText = normalizeValue(i.verifikator_nama);
    if (document.getElementById('mAlasanTolak')) document.getElementById('mAlasanTolak').innerText = normalizeValue(i.alasan_tolak); 

    const modal = document.getElementById('previewModal');
    if (modal) {
        modal.style.display = 'flex';
        const modalCard = modal.querySelector('.modal-content');
        if (modalCard) {
            modalCard.style.display = 'block'; 
        }
    }
};

window.closePreviewModal = function() {
    const modal = document.getElementById('previewModal');
    if (modal) modal.style.display = 'none';
};

// ==========================================
// 8. AREA DASHBOARD METRICS & CHARTS
// ==========================================

// PENYESUAIAN GLOBAL & HANDLER TOGGLE KPO
window.handleKPOFilterChange = function() {
    const toggle = document.getElementById('toggleIncludeKPO');
    if (toggle) {
        window.includeKPO = toggle.checked;
    }
    
    // Hanya perlu memanggil fungsi master filter (semua chart & table akan terupdate)
    window.updateDashboardMetrics();
};

function initCharts() {
    const canvas = document.getElementById('mainTotalChart'); if(!canvas) return;
    if (mainTotalChart) mainTotalChart.destroy();
    
    mainTotalChart = new Chart(canvas.getContext('2d'), {
        type: 'bar', 
        data: { 
            labels: ['Status'], 
            datasets: [
                { label: 'MS', data: [0], backgroundColor: '#2ecc71' }, 
                { label: 'BTS', data: [0], backgroundColor: '#f1c40f' }, 
                { label: 'TMS', data: [0], backgroundColor: '#e74c3c' }, 
                { label: 'Inbox', data: [0], backgroundColor: '#3498db' }
            ] 
        },
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { title: { display: true, text: 'Rekapitulasi Usulan KP' } }, 
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } 
        }
    });
}

function updateDashboardChartsAndCards(filteredData) {
    if (!mainTotalChart) initCharts();
    if (!mainTotalChart) return;

    let ms = 0, bts = 0, tms = 0, inb = 0, kReg = 0, kIj = 0, kJf = 0, kStr = 0; 
    const rMap = {};
    const sInst = document.getElementById('dashFilterInstansi')?.value;

    // KARENA DATA 'filteredData' SUDAH DISARING KPO DI FUNGSI MASTER, KITA BISA LANGSUNG ITERASI!
    filteredData.forEach(i => {
        if (i.instansi_induk && i.instansi_induk !== '--') {
            const k = cleanInstansiName(i.instansi_induk); 
            if (!rMap[k]) rMap[k] = { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Total: 0 };
            
            if (i.kategori_status === 'MS') rMap[k].MS++; 
            else if (i.kategori_status === 'BTS') rMap[k].BTS++; 
            else if (i.kategori_status === 'TMS') rMap[k].TMS++; 
            else rMap[k].Inbox++; 
            rMap[k].Total++;
        }
        
        if (i.kategori_status === 'MS') ms++; 
        else if (i.kategori_status === 'BTS') bts++; 
        else if (i.kategori_status === 'TMS') tms++; 
        else inb++;
        
        const j = formatJenisKP(i.jenis_kp); 
        if (j === "KP Reguler") kReg++; 
        else if (j === "KP Penyesuaian Ijazah") kIj++; 
        else if (j === "KP JF") kJf++; 
        else if (j === "KP Struktural") kStr++;
    });

    mainTotalChart.options.plugins.title.text = `Rekap - ${sInst ? cleanInstansiName(sInst) : 'Semua Instansi'}`;
    mainTotalChart.data.datasets[0].data = [ms]; 
    mainTotalChart.data.datasets[1].data = [bts]; 
    mainTotalChart.data.datasets[2].data = [tms]; 
    mainTotalChart.data.datasets[3].data = [inb]; 
    mainTotalChart.update();
    
    if(document.getElementById('totalSummaryBadge')) document.getElementById('totalSummaryBadge').innerHTML = `Total Usulan: <strong>${ms+bts+tms+inb} Data</strong>`;
    if(document.getElementById('cardMsValue')) document.getElementById('cardMsValue').innerText = ms;
    if(document.getElementById('cardBtsValue')) document.getElementById('cardBtsValue').innerText = bts;
    if(document.getElementById('cardTmsValue')) document.getElementById('cardTmsValue').innerText = tms;
    if(document.getElementById('cardInboxValue')) document.getElementById('cardInboxValue').innerText = inb;
    
    if(document.getElementById('miniKpReguler')) document.getElementById('miniKpReguler').innerText = kReg;
    if(document.getElementById('miniKpIjazah')) document.getElementById('miniKpIjazah').innerText = kIj;
    if(document.getElementById('miniKpJf')) document.getElementById('miniKpJf').innerText = kJf;
    if(document.getElementById('miniKpStruktural')) document.getElementById('miniKpStruktural').innerText = kStr;
    
    const g = document.getElementById('donutCardsGrid'); 
    if (!g) return; 
    g.innerHTML = '';
    
    Object.keys(donutChartInstancesMap).forEach(k => donutChartInstancesMap[k]?.destroy()); 
    donutChartInstancesMap = {};
    
    const kKeys = Object.keys(rMap).sort(); 
    if (kKeys.length === 0) { 
        g.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Belum ada data.</p>'; 
        return; 
    }
    
    kKeys.forEach((k, idx) => {
        const id = `donut_${idx}`, d = document.createElement('div'); d.className = 'donut-card-box';
        d.innerHTML = `<div class="donut-card-title">${k}</div><div class="donut-card-badge">Total: ${rMap[k].Total}</div><div class="donut-canvas-wrapper"><canvas id="${id}"></canvas></div>`;
        g.appendChild(d);
        
        donutChartInstancesMap[id] = new Chart(document.getElementById(id).getContext('2d'), { 
            type: 'doughnut', 
            data: { 
                labels: [`MS`, `BTS`, `TMS`, `Inbox`], 
                datasets: [{ 
                    data: [rMap[k].MS, rMap[k].BTS, rMap[k].TMS, rMap[k].Inbox], 
                    backgroundColor: ['#2ecc71', '#f1c40f', '#e74c3c', '#3498db'] 
                }] 
            }, 
            options: { 
                responsive: true, maintainAspectRatio: false, 
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } 
            } 
        });
    });
}

// FUNGSI MASTER FILTER UNTUK SELURUH DASHBOARD
window.updateDashboardMetrics = function() {
    const elPeriodeKP = document.getElementById('dashFilterPeriodeKP');
    const elInstansi = document.getElementById('dashFilterInstansi');
    const elDateFrom = document.getElementById('dashDateFrom');
    const elDateTo = document.getElementById('dashDateTo');
    
    const elToggleKPO = document.getElementById('toggleIncludeKPO');
    const includeKPO = elToggleKPO ? elToggleKPO.checked : true;
    window.includeKPO = includeKPO; // Update global state

    const selectedPeriodeKP = elPeriodeKP ? elPeriodeKP.value.trim().toUpperCase() : '';
    const selectedFilterInstansi = elInstansi ? elInstansi.value.trim() : '';
    const dateFromVal = elDateFrom ? elDateFrom.value : '';
    const dateToVal = elDateTo ? elDateTo.value : '';

    window.currentDashboardFilteredData = combinedDataList.filter(item => {
        if (!window.isEligibleForApp(item)) return false;
        
        // FILTER KPO MENGGUNAKAN LOGIKA AKURAT YANG SAMA DENGAN UI BADGE
        if (!includeKPO && window.checkIsKPO(item)) {
            return false;
        }
        
        if (selectedPeriodeKP !== '') {
            const periodeItem = String(item.periode_kp || item.periode || '').trim().toUpperCase();
            if (!periodeItem.includes(selectedPeriodeKP)) return false;
        }

        if (selectedFilterInstansi !== '' && item.instansi_induk !== selectedFilterInstansi) return false;

        const tglStr = item.tgl_pengiriman_kelayanan;
        if (tglStr && tglStr !== '--') {
            if (dateFromVal !== '' && tglStr < dateFromVal) return false;
            if (dateToVal !== '' && tglStr > dateToVal) return false;
        }
        return true;
    });

    updateDashboardChartsAndCards(window.currentDashboardFilteredData);
    renderAllRegionalTables(window.currentDashboardFilteredData);
    
    if (typeof window.renderDailyTrendChart === 'function') {
        window.renderDailyTrendChart(window.currentDashboardFilteredData);
    }
};

window.resetDashboardFilters = function(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    
    ['dashFilterInstansi', 'dashFilterPeriodeKP', 'dashDateFrom', 'dashDateTo'].forEach(id => {
        if (document.getElementById(id)) document.getElementById(id).value = '';
    });
    
    // KEMBALIKAN TOGGLE KPO KE ON (DEFAULT)
    const elToggleKPO = document.getElementById('toggleIncludeKPO');
    if (elToggleKPO) elToggleKPO.checked = true;
    window.includeKPO = true;
    
    updateFilterActiveState();
    window.updateDashboardMetrics();
};

let dailyTrendChartInstance = null; 
window.renderDailyTrendChart = function(activeDataList) {
    const ctx = document.getElementById('dailyTrendChart');
    if (!ctx) return;

    const dateCounts = {};
    activeDataList.forEach(item => {
        const rawDate = item.tgl_pengiriman_kelayanan;
        if (rawDate && rawDate !== '--') {
            dateCounts[rawDate] = (dateCounts[rawDate] || 0) + 1;
        }
    });

    const sortedDates = Object.keys(dateCounts).sort();
    const NAMA_BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    
    const labels = sortedDates.map(dateStr => {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const y = parts[0], m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
            return `${d} ${NAMA_BULAN_SINGKAT[m]} ${y}`;
        }
        return dateStr;
    });
    
    const dataPoints = sortedDates.map(date => dateCounts[date]);

    const chartDateEl = document.getElementById('trendChartDateText');
    if (chartDateEl && typeof getExportHeaderDateText === 'function') {
        chartDateEl.innerHTML = getExportHeaderDateText(activeDataList);
    }

    if (dailyTrendChartInstance) {
        dailyTrendChartInstance.destroy();
    }

    dailyTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Jumlah Usulan',
                data: dataPoints,
                borderColor: '#0284c7',          
                backgroundColor: 'rgba(2, 132, 199, 0.1)', 
                borderWidth: 2.5,
                pointBackgroundColor: '#ffffff', 
                pointBorderColor: '#0284c7',     
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.3                     
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }, 
                tooltip: {
                    backgroundColor: '#0f172a', padding: 10,
                    callbacks: { label: function(context) { return ` ${context.parsed.y} Berkas Usulan`; } }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }, 
                    grid: { color: '#e2e8f0', borderDash: [5, 5] } 
                },
                x: {
                    grid: { display: false } 
                }
            }
        }
    });
};

// ==========================================
// 9. MENU & SIDEBAR NAVIGATION
// ==========================================
window.showSection = function(sectionId, moduleName = null) {
    const targetSec = document.getElementById(sectionId);
    if (!targetSec) {
        console.warn(`Section dengan ID "${sectionId}" tidak ditemukan.`);
        return;
    }

    document.querySelectorAll('.section').forEach(sec => {
        sec.classList.remove('active');
        sec.style.display = 'none';
    });

    targetSec.style.display = 'block';
    
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            targetSec.classList.add('active');
        });
    });

    document.querySelectorAll('#sidebarContainer a').forEach(a => a.classList.remove('active'));
    const activeBtn = document.querySelector(`#sidebarContainer a[onclick*="${sectionId}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    if (moduleName) {
        currentModule = moduleName;
        if (typeof loadDatabaseData === 'function') {
            loadDatabaseData();
        }
    }
};

function setupSidebarToggle() {
    const s = document.getElementById('sidebarContainer'), m = document.getElementById('mainContent'), b = document.getElementById('sidebarMobileBackdrop'), btn = document.getElementById('btnToggleSidebar'), btnHamburger = document.getElementById('btnMobileHamburger');
    if (!s || !m) return;
    
    s.classList.add('collapsed'); m.classList.add('expanded');
    
    const tog = () => { 
        s.classList.toggle('collapsed'); 
        m.classList.toggle('expanded'); 
        if (btn) btn.innerText = s.classList.contains('collapsed') ? '➕' : '❌'; 
        if (window.innerWidth <= 768 && b) { b.classList.toggle('active', !s.classList.contains('collapsed')); } 
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300); 
    };
    
    if (btn) btn.onclick = e => { e.preventDefault(); e.stopPropagation(); tog(); };
    if (btnHamburger) btnHamburger.onclick = e => { e.preventDefault(); e.stopPropagation(); tog(); };
    if (b) { b.onclick = () => { s.classList.add('collapsed'); b.classList.remove('active'); if (btn) btn.innerText = '十'; }; }
    
    document.addEventListener('click', (e) => { 
        const isMobile = window.innerWidth <= 768; 
        const isSidebarOpen = !s.classList.contains('collapsed'); 
        if (isMobile && isSidebarOpen) { 
            const isClickInsideSidebar = s.contains(e.target); 
            const isClickOnHamburger = btnHamburger && btnHamburger.contains(e.target); 
            if (!isClickInsideSidebar && !isClickOnHamburger) { 
                s.classList.add('collapsed'); 
                if (b) b.classList.remove('active'); 
                if (btn) btn.innerText = '十'; 
            } 
        } 
    });
}

// ==========================================
// 10. MODAL & PREVIEW 
// ==========================================
window.openSummaryTableModal = function(filterType, filterValue) {
    const selectedInstansi = document.getElementById('dashFilterInstansi')?.value;
    const selectedPeriodeKP = document.getElementById('dashFilterPeriodeKP')?.value;
    const dateFromVal = document.getElementById('dashDateFrom')?.value;
    const dateToVal = document.getElementById('dashDateTo')?.value;

    const filtered = combinedDataList.filter(item => {
        if (!window.isEligibleForApp(item)) return false;
        
        // PASTIKAN MODAL INI JUGA MENGHORMATI TOGGLE KPO!
        if (!window.includeKPO && window.checkIsKPO(item)) return false;
        
        if (filterType === 'kategori' && item.kategori_status !== filterValue) return false;
        if (filterType === 'jenis' && formatJenisKP(item.jenis_kp) !== filterValue) return false;
        if (selectedInstansi && selectedInstansi.trim() !== '' && item.instansi_induk !== selectedInstansi) return false;

        if (selectedPeriodeKP && selectedPeriodeKP.trim() !== '') {
            const periodeItem = String(item.periode_kp || item.periode || calculatePeriodeKP(item.tgl_pengiriman_kelayanan) || '').trim().toUpperCase();
            const targetPeriode = selectedPeriodeKP.trim().toUpperCase();
            if (!periodeItem.includes(targetPeriode)) return false;
        }

        const tglStr = item.tgl_pengiriman_kelayanan;
        if (tglStr && tglStr !== '--') {
            if (dateFromVal && tglStr < dateFromVal) return false;
            if (dateToVal && tglStr > dateToVal) return false;
        }

        return true;
    });

    const titleEl = document.getElementById('summaryModalTitle'); 
    if (titleEl) {
        titleEl.innerText = `Daftar Usulan: ${filterValue} (${filtered.length} Data)`;
    }

    currentDetailSummaryDataList = filtered; 
    detailSummarySortCol = 'tgl_pengiriman_kelayanan'; 
    detailSummarySortAsc = false; 

    renderDetailSummaryTable();

    const modal = document.getElementById('summaryTableModal'); 
    if (modal) { 
        modal.style.display = 'flex'; 
        const innerContent = modal.querySelector('.modal-content'); 
        if (innerContent) innerContent.style.display = 'block'; 
    }
};

window.openRekapAngkaModal = function() {
    const activeDataList = Array.isArray(window.currentDashboardFilteredData) && window.currentDashboardFilteredData.length > 0
        ? window.currentDashboardFilteredData
        : (combinedDataList ? combinedDataList.filter(i => {
              if(!window.isEligibleForApp(i)) return false;
              if(!window.includeKPO && window.checkIsKPO(i)) return false;
              return true;
          }) : []);
        
    const dateTextHtml = getExportHeaderDateText(activeDataList);
    
    const elDateA = document.getElementById('modalRekapDateTextA');
    const elDateB = document.getElementById('modalRekapDateTextB');
    if (elDateA) elDateA.innerHTML = dateTextHtml;
    if (elDateB) elDateB.innerHTML = dateTextHtml;

    const regionMap = {
        'Prov. Papua Barat': REGION_PAPUA_BARAT.map(n => cleanInstansiName(n)),
        'Prov. Papua Barat Daya': REGION_PAPUA_BARAT_DAYA.map(n => cleanInstansiName(n)),
        'Instansi Vertikal': REGION_INSTANSI_VERTIKAL.map(n => cleanInstansiName(n))
    };

    const statsByRegion = {
        'Prov. Papua Barat': { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Reguler: 0, Ijazah: 0, JF: 0, Struktural: 0 },
        'Prov. Papua Barat Daya': { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Reguler: 0, Ijazah: 0, JF: 0, Struktural: 0 },
        'Instansi Vertikal': { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Reguler: 0, Ijazah: 0, JF: 0, Struktural: 0 },
        'Lainnya / Tidak Terdefinisi': { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Reguler: 0, Ijazah: 0, JF: 0, Struktural: 0 }
    };

    activeDataList.forEach(item => {
        const cleanInst = cleanInstansiName(item.instansi_induk);
        let matchedRegion = 'Lainnya / Tidak Terdefinisi';

        for (const [regName, instList] of Object.entries(regionMap)) {
            if (instList.includes(cleanInst)) {
                matchedRegion = regName;
                break;
            }
        }

        const statusKat = item.kategori_status;
        if (statusKat === 'MS') statsByRegion[matchedRegion].MS++;
        else if (statusKat === 'BTS') statsByRegion[matchedRegion].BTS++;
        else if (statusKat === 'TMS') statsByRegion[matchedRegion].TMS++;
        else statsByRegion[matchedRegion].Inbox++;

        const jenis = formatJenisKP(item.jenis_kp);
        if (jenis === 'KP Reguler') statsByRegion[matchedRegion].Reguler++;
        else if (jenis === 'KP Penyesuaian Ijazah') statsByRegion[matchedRegion].Ijazah++;
        else if (jenis === 'KP JF') statsByRegion[matchedRegion].JF++;
        else if (jenis === 'KP Struktural') statsByRegion[matchedRegion].Struktural++;
    });

    const tbodyStatus = document.getElementById('tbodyRekapStatusRegional');
    if (tbodyStatus) tbodyStatus.innerHTML = '';

    let sumMs = 0, sumBts = 0, sumTms = 0, sumInbox = 0, sumGrandTotalStatus = 0;

    Object.keys(statsByRegion).forEach(regKey => {
        const d = statsByRegion[regKey];
        const rowTotal = d.MS + d.BTS + d.TMS + d.Inbox;
        
        if (rowTotal > 0 || regKey !== 'Lainnya / Tidak Terdefinisi') {
            sumMs += d.MS; sumBts += d.BTS; sumTms += d.TMS; sumInbox += d.Inbox; sumGrandTotalStatus += rowTotal;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-region"><strong>${regKey}</strong></td>
                <td class="col-num" style="color: #16a34a; font-weight: bold;">${d.MS}</td>
                <td class="col-num" style="color: #d97706; font-weight: bold;">${d.BTS}</td>
                <td class="col-num" style="color: #dc2626; font-weight: bold;">${d.TMS}</td>
                <td class="col-num" style="color: #2563eb; font-weight: bold;">${d.Inbox}</td>
                <td class="col-num td-total-col" style="font-weight: bold;">${rowTotal}</td>
            `;
            tbodyStatus.appendChild(tr);
        }
    });

    if (document.getElementById('rekMs')) document.getElementById('rekMs').innerText = sumMs;
    if (document.getElementById('rekBts')) document.getElementById('rekBts').innerText = sumBts;
    if (document.getElementById('rekTms')) document.getElementById('rekTms').innerText = sumTms;
    if (document.getElementById('rekInbox')) document.getElementById('rekInbox').innerText = sumInbox;
    if (document.getElementById('rekTotalStatus')) document.getElementById('rekTotalStatus').innerText = sumGrandTotalStatus;

    const tbodyJenis = document.getElementById('tbodyRekapJenisRegional');
    if (tbodyJenis) tbodyJenis.innerHTML = '';

    let sumReg = 0, sumIj = 0, sumJf = 0, sumStruk = 0, sumGrandTotalJenis = 0;

    Object.keys(statsByRegion).forEach(regKey => {
        const d = statsByRegion[regKey];
        const rowTotal = d.Reguler + d.Ijazah + d.JF + d.Struktural;

        if (rowTotal > 0 || regKey !== 'Lainnya / Tidak Terdefinisi') {
            sumReg += d.Reguler; sumIj += d.Ijazah; sumJf += d.JF; sumStruk += d.Struktural; sumGrandTotalJenis += rowTotal;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-region"><strong>${regKey}</strong></td>
                <td class="col-num">${d.Reguler}</td>
                <td class="col-num">${d.Ijazah}</td>
                <td class="col-num">${d.JF}</td>
                <td class="col-num">${d.Struktural}</td>
                <td class="col-num td-total-col" style="font-weight: bold;">${rowTotal}</td>
            `;
            tbodyJenis.appendChild(tr);
        }
    });

    if (document.getElementById('rekReg')) document.getElementById('rekReg').innerText = sumReg;
    if (document.getElementById('rekIj')) document.getElementById('rekIj').innerText = sumIj;
    if (document.getElementById('rekJf')) document.getElementById('rekJf').innerText = sumJf;
    if (document.getElementById('rekStruk')) document.getElementById('rekStruk').innerText = sumStruk;
    if (document.getElementById('rekTotalJenis')) document.getElementById('rekTotalJenis').innerText = sumGrandTotalJenis;

    const modal = document.getElementById('rekapAngkaModal');
    if (modal) {
        modal.style.display = 'flex';
        const innerContent = modal.querySelector('.modal-content');
        if (innerContent) innerContent.style.display = 'block';
    }
};

let currentInstansiDataList = [], instansiSortCol = 'Total', instansiSortAsc = false;
let currentDetailSummaryDataList = [], detailSummarySortCol = 'tgl_pengiriman_kelayanan', detailSummarySortAsc = false;

window.openRekapInstansiModal = function() {
    const angkaModal = document.getElementById('rekapAngkaModal'); if (angkaModal) angkaModal.style.display = 'none';
    const instansiModal = document.getElementById('rekapInstansiModal'); if (!instansiModal) return;

    const selectedFilterInstansi = document.getElementById('dashFilterInstansi')?.value;
    const selectedPeriodeKP = document.getElementById('dashFilterPeriodeKP')?.value;
    const dateFromVal = document.getElementById('dashDateFrom')?.value;
    const dateToVal = document.getElementById('dashDateTo')?.value;
    const instansiMap = {};

    combinedDataList.forEach(item => {
        if (!window.isEligibleForApp(item)) return false;
        
        // PASTIKAN MODAL INI JUGA MENGHORMATI TOGGLE KPO!
        if (!window.includeKPO && window.checkIsKPO(item)) return false;
        
        if (selectedFilterInstansi && item.instansi_induk !== selectedFilterInstansi) return;
        if (selectedPeriodeKP) {
            const periodeItem = String(item.periode_kp || item.periode || '').trim().toUpperCase();
            if (!periodeItem.includes(selectedPeriodeKP.toUpperCase())) return;
        }
        
        const tglStr = item.tgl_pengiriman_kelayanan;
        if (tglStr && tglStr !== '--') {
            if (dateFromVal && tglStr < dateFromVal) return;
            if (dateToVal && tglStr > dateToVal) return;
        }
        
        const fullInst = item.instansi_induk;
        if (fullInst && fullInst !== '--') {
            const cleanName = cleanInstansiName(fullInst);
            if (!instansiMap[cleanName]) instansiMap[cleanName] = { fullInst: fullInst, name: cleanName, MS: 0, BTS: 0, TMS: 0, Inbox: 0, Total: 0 };
            
            const status = item.kategori_status;
            if (status === 'MS') instansiMap[cleanName].MS++; 
            else if (status === 'BTS') instansiMap[cleanName].BTS++; 
            else if (status === 'TMS') instansiMap[cleanName].TMS++; 
            else instansiMap[cleanName].Inbox++; 
            
            instansiMap[cleanName].Total++;
        }
    });

    currentInstansiDataList = Object.values(instansiMap); 
    instansiSortCol = 'Total'; 
    instansiSortAsc = false; 
    renderRekapInstansiTable();
    
    instansiModal.style.display = 'flex'; 
    const innerCard = instansiModal.querySelector('.modal-content'); 
    if (innerCard) innerCard.style.display = 'block';
};

window.sortRekapInstansiTable = function(colName) { 
    if (instansiSortCol === colName) { 
        instansiSortAsc = !instansiSortAsc; 
    } else { 
        instansiSortCol = colName; 
        instansiSortAsc = (colName === 'name'); 
    } 
    renderRekapInstansiTable(); 
};

function renderRekapInstansiTable() {
    currentInstansiDataList.sort((a, b) => { 
        let valA = a[instansiSortCol], valB = b[instansiSortCol]; 
        if (typeof valA === 'string') return instansiSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA); 
        return instansiSortAsc ? valA - valB : valB - valA; 
    });
    
    ['name', 'MS', 'BTS', 'TMS', 'Inbox', 'Total'].forEach(c => { 
        const el = document.getElementById(`sort_inst_${c}`); 
        if (el) el.innerText = '↕'; 
    });
    
    const activeArrow = document.getElementById(`sort_inst_${instansiSortCol}`); 
    if (activeArrow) activeArrow.innerText = instansiSortAsc ? '▲' : '▼';
    
    const tbody = document.getElementById('tabelRekapInstansiBody'), tfoot = document.getElementById('tabelRekapInstansiFoot'); 
    if (!tbody) return; tbody.innerHTML = ''; if (tfoot) tfoot.innerHTML = '';
    
    if (currentInstansiDataList.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:15px; color:#7f8c8d;">Tidak ada data instansi.</td></tr>'; 
        return; 
    }
    
    let sumMs = 0, sumBts = 0, sumTms = 0, sumInbox = 0, sumGrandTotal = 0;
    currentInstansiDataList.forEach((data, idx) => {
        sumMs += data.MS; sumBts += data.BTS; sumTms += data.TMS; sumInbox += data.Inbox; sumGrandTotal += data.Total; 
        
        const tr = document.createElement('tr'); 
        const safeFullInst = data.fullInst.replace(/'/g, "\\'");
        tr.innerHTML = `
            <td style="text-align: center;">${idx + 1}</td>
            <td><span class="clickable-instansi-link" style="color:#0284c7; cursor:pointer; font-weight:bold;" onclick="window.openDetailInstansiSummaryModal('${safeFullInst}')">${data.name} 🔍</span></td>
            <td style="text-align: center; color: #16a34a; font-weight: bold;">${data.MS}</td>
            <td style="text-align: center; color: #d97706; font-weight: bold;">${data.BTS}</td>
            <td style="text-align: center; color: #dc2626; font-weight: bold;">${data.TMS}</td>
            <td style="text-align: center; color: #2563eb; font-weight: bold;">${data.Inbox}</td>
            <td class="td-total-col" style="text-align: center; font-weight: bold;">${data.Total}</td>
        `; 
        tbody.appendChild(tr);
    });
    
    if (tfoot) { 
        tfoot.innerHTML = `
            <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="2" style="text-align: right; padding-right: 15px;">TOTAL KESELURUHAN:</td>
                <td style="text-align: center; color: #16a34a; font-weight: 800;">${sumMs}</td>
                <td style="text-align: center; color: #d97706; font-weight: 800;">${sumBts}</td>
                <td style="text-align: center; color: #dc2626; font-weight: 800;">${sumTms}</td>
                <td style="text-align: center; color: #2563eb; font-weight: 800;">${sumInbox}</td>
                <td class="td-total-col" style="text-align: center; font-size: 13px; font-weight: 800;">${sumGrandTotal}</td>
            </tr>
        `; 
    }
}

window.openDetailInstansiSummaryModal = function(fullInstansiName) {
    const selectedPeriodeKP = document.getElementById('dashFilterPeriodeKP')?.value;
    const dateFromVal = document.getElementById('dashDateFrom')?.value;
    const dateToVal = document.getElementById('dashDateTo')?.value;

    const filtered = combinedDataList.filter(item => {
        if (!window.isEligibleForApp(item)) return false;
        
        // PASTIKAN MODAL INI JUGA MENGHORMATI TOGGLE KPO!
        if (!window.includeKPO && window.checkIsKPO(item)) return false;
        
        if (item.instansi_induk !== fullInstansiName) return false;
        if (selectedPeriodeKP) {
            const periodeItem = String(item.periode_kp || item.periode || '').trim().toUpperCase();
            if (!periodeItem.includes(selectedPeriodeKP.toUpperCase())) return false;
        }
        
        const tglStr = item.tgl_pengiriman_kelayanan;
        if (tglStr && tglStr !== '--') {
            if (dateFromVal && tglStr < dateFromVal) return false;
            if (dateToVal && tglStr > dateToVal) return false;
        }
        return true;
    });

    const titleEl = document.getElementById('summaryModalTitle'); 
    if (titleEl) titleEl.innerText = `Daftar Usulan KP: ${cleanInstansiName(fullInstansiName)} (${filtered.length} Data)`;
    
    currentDetailSummaryDataList = filtered; 
    detailSummarySortCol = 'tgl_pengiriman_kelayanan'; 
    detailSummarySortAsc = false; 
    renderDetailSummaryTable();
    
    const summaryModal = document.getElementById('summaryTableModal'); 
    if (summaryModal) { 
        summaryModal.style.display = 'flex'; 
        const innerCard = summaryModal.querySelector('.modal-content'); 
        if (innerCard) innerCard.style.display = 'block'; 
    }
};

window.sortDetailSummaryTable = function(colName) { 
    if (detailSummarySortCol === colName) {
        detailSummarySortAsc = !detailSummarySortAsc; 
    } else { 
        detailSummarySortCol = colName; 
        detailSummarySortAsc = (colName === 'nama' || colName === 'instansi_induk'); 
    } 
    renderDetailSummaryTable(); 
};

function renderDetailSummaryTable() {
    currentDetailSummaryDataList.sort((a, b) => { 
        let valA = a[detailSummarySortCol] || '--', valB = b[detailSummarySortCol] || '--'; 
        if (detailSummarySortCol === 'tgl_pengiriman_kelayanan') { 
            valA = (valA === '--') ? new Date(0) : new Date(valA); 
            valB = (valB === '--') ? new Date(0) : new Date(valB); 
        } else if (detailSummarySortCol === 'jenis_kp') { 
            valA = formatJenisKP(valA); 
            valB = formatJenisKP(valB); 
        } 
        if (valA < valB) return detailSummarySortAsc ? -1 : 1; 
        if (valA > valB) return detailSummarySortAsc ? 1 : -1; 
        return 0; 
    });

    const columns = ['uploader_initial', 'instansi_induk', 'tgl_pengiriman_kelayanan', 'nama', 'nip', 'jenis_kp', 'kategori_status', 'status_usulan', 'no_pertek']; 
    columns.forEach(col => { 
        const iconEl = document.getElementById(`sort_det_${col}`); 
        if (iconEl) iconEl.innerText = '↕'; 
    });

    const activeIcon = document.getElementById(`sort_det_${detailSummarySortCol}`); 
    if (activeIcon) activeIcon.innerText = detailSummarySortAsc ? '▲' : '▼';

    const tbody = document.getElementById('summaryExportTableBody'); 
    if (!tbody) return; 
    tbody.innerHTML = '';

    if (currentDetailSummaryDataList.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:15px; color:#7f8c8d;">Tidak ada data usulan yang sesuai filter.</td></tr>'; 
        return; 
    }

    currentDetailSummaryDataList.forEach((item, idx) => {
        const uInit = (item.uploader_initial && item.uploader_initial !== '--') ? String(item.uploader_initial).toUpperCase() : 'OP'; 
        const bCol = getColorForInitial(uInit); 
        const fTime = formatDateTime(item.uploaded_at);
        const bHtml = `<span class="id-initial-badge" style="background-color:${bCol.bg}; color:${bCol.color}; cursor:pointer;" title="📌 Diunggah oleh ID: ${uInit}&#10;🕒 Waktu Simpan DB: ${fTime}">${uInit}</span>`;

        const isKpo = window.checkIsKPO(item);
        const kpoBadge = isKpo ? `<span style="background-color: #8b5cf6; color: white; padding: 1px 6px; border-radius: 4px; font-size: 8px; font-weight: bold; margin-left: 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); vertical-align: middle;">KPO</span>` : '';

        const tr = document.createElement('tr'); 
        tr.innerHTML = `
            <td style="text-align: center;">${idx + 1}</td>
            <td style="text-align: center;">${bHtml}</td>
            <td>${cleanInstansiName(item.instansi_induk)}</td>
            <td>${normalizeValue(item.tgl_pengiriman_kelayanan)}</td>
            <td>${normalizeValue(item.nama)}</td>
            <td>${normalizeValue(item.nip)}</td>
            <td><strong>${formatJenisKP(item.jenis_kp)}</strong></td>
            <td><strong>${normalizeValue(item.kategori_status)}</strong><br>${kpoBadge}</td>
            <td>${normalizeValue(item.status_usulan)}</td>
            <td>${normalizeValue(item.no_pertek)}</td>
        `; 
        tbody.appendChild(tr);
    });
}

// =======================================================
// MODAL TAMBAH DATA: MASTER DATA INSTANSI & KATEGORI WILKER (DEFAULT)
// =======================================================
// =======================================================
// MASTER DATA INSTANSI & KATEGORI WILKER
// =======================================================
let masterInstansiData = JSON.parse(localStorage.getItem('master_instansi_pi')) || [
    // --- WILAYAH 1: PAPUA BARAT ---
    { name: "Prov. Papua Barat", wilker: "Papua Barat" },
    { name: "Kab. Manokwari", wilker: "Papua Barat" },
    { name: "Kab. Manokwari Selatan", wilker: "Papua Barat" },
    { name: "Kab. Pegunungan Arfak", wilker: "Papua Barat" },
    { name: "Kab. Teluk Bintuni", wilker: "Papua Barat" },
    { name: "Kab. Teluk Wondama", wilker: "Papua Barat" },
    { name: "Kab. Kaimana", wilker: "Papua Barat" },
    { name: "Kab. Fak-fak", wilker: "Papua Barat" },

    // --- WILAYAH 2: PAPUA BARAT DAYA ---
    { name: "Prov. Papua Barat Daya", wilker: "Papua Barat Daya" },
    { name: "Kota Sorong", wilker: "Papua Barat Daya" },
    { name: "Kab. Sorong", wilker: "Papua Barat Daya" },
    { name: "Kab. Sorong Selatan", wilker: "Papua Barat Daya" },
    { name: "Kab. Raja Ampat", wilker: "Papua Barat Daya" },
    { name: "Kab. Tambrauw", wilker: "Papua Barat Daya" },
    { name: "Kab. Maybrat", wilker: "Papua Barat Daya" },

    // --- WILAYAH 3: INSTANSI VERTIKAL (KEMENTERIAN / LEMBAGA) ---
    { name: "Mahkamah Agung", wilker: "Instansi Vertikal" },
    { name: "Kejaksaan Agung", wilker: "Instansi Vertikal" },
    { name: "Kementerian Hukum Dan HAM", wilker: "Instansi Vertikal" },
    { name: "Kementerian Agama", wilker: "Instansi Vertikal" },
    { name: "Kementerian Keuangan", wilker: "Instansi Vertikal" },
    { name: "Kementerian Kesehatan", wilker: "Instansi Vertikal" },
    { name: "Kementerian Agraria Dan Tata Ruang/BPN", wilker: "Instansi Vertikal" },
    { name: "Badan Pertanahan Nasional", wilker: "Instansi Vertikal" },
    { name: "Badan Pusat Statistik", wilker: "Instansi Vertikal" },
    { name: "Badan Meteorologi, Klimatologi, Dan Geofisika", wilker: "Instansi Vertikal" },
    { name: "Kepolisian Negara Republik Indonesia", wilker: "Instansi Vertikal" }
];

// =======================================================
// FUNGSI MEMUAT ISI DROPDOWN FILTER INSTANSI ASAL & TUJUAN
// =======================================================
// =======================================================
// FUNGSI MEMBACA INSTANSI YANG EXIST DI TABEL
// =======================================================
window.populatePIFilters = function() {
    const filterAsalEl = document.getElementById('filterInstansiAsalPI');
    const filterTujuanEl = document.getElementById('filterInstansiTujuanPI');

    if (!filterAsalEl || !filterTujuanEl) return;

    // Simpan nilai pilihan user yang sedang aktif agar tidak ter-reset
    const currentAsal = filterAsalEl.value;
    const currentTujuan = filterTujuanEl.value;

    const instansiAsalSet = new Set();
    const instansiTujuanSet = new Set();

    // Ambil data utama yang sedang dimuat (mendukung rawPIData atau dbFetchedMap)
    let sourceData = [];
    if (typeof rawPIData !== 'undefined' && Array.isArray(rawPIData)) {
        sourceData = rawPIData;
    } else if (typeof dbFetchedMap !== 'undefined' && dbFetchedMap) {
        sourceData = Object.values(dbFetchedMap);
    }

    // Jika data tabel belum ada / kosong, jangan lakukan apa-apa
    if (sourceData.length === 0) return;

    // Ekstraksi hanya nama instansi yang ada pada baris-baris data
    sourceData.forEach(rec => {
        if (rec.instansi_asal && String(rec.instansi_asal).trim() !== '') {
            const asalBaku = (typeof standardizeInstansiName === 'function') 
                ? standardizeInstansiName(rec.instansi_asal) 
                : String(rec.instansi_asal).trim();
            instansiAsalSet.add(asalBaku);
        }

        if (rec.instansi_tujuan && String(rec.instansi_tujuan).trim() !== '') {
            const tujuanBaku = (typeof standardizeInstansiName === 'function') 
                ? standardizeInstansiName(rec.instansi_tujuan) 
                : String(rec.instansi_tujuan).trim();
            instansiTujuanSet.add(tujuanBaku);
        }
    });

    // Urutkan nama instansi secara alfabetis (A-Z)
    const sortedAsal = Array.from(instansiAsalSet).sort((a, b) => a.localeCompare(b));
    const sortedTujuan = Array.from(instansiTujuanSet).sort((a, b) => a.localeCompare(b));

    // Susun opsi dropdown Instansi Asal
    let optionsHtmlAsal = '<option value="">-- Semua Instansi Asal --</option>';
    sortedAsal.forEach(nama => {
        optionsHtmlAsal += `<option value="${nama}">${nama}</option>`;
    });

    // Susun opsi dropdown Instansi Tujuan
    let optionsHtmlTujuan = '<option value="">-- Semua Instansi Tujuan --</option>';
    sortedTujuan.forEach(nama => {
        optionsHtmlTujuan += `<option value="${nama}">${nama}</option>`;
    });

    // Masukkan hasil opsi ke dalam elemen <select> HTML
    filterAsalEl.innerHTML = optionsHtmlAsal;
    filterTujuanEl.innerHTML = optionsHtmlTujuan;

    // Kembalikan ke nilai pilihan user sebelumnya jika opsi tersebut masih ada
    filterAsalEl.value = currentAsal;
    filterTujuanEl.value = currentTujuan;
};

// =======================================================
// UPDATE FUNGSI RENDER DATALIST AGAR SEKALIGUS UPDATE FILTER
// =======================================================
window.renderInstansiDatalist = function() {
    const datalist = document.getElementById('listInstansiSuggest');
    if (datalist && typeof masterInstansiData !== 'undefined') {
        datalist.innerHTML = masterInstansiData.map(item => `<option value="${item.name}"></option>`).join('');
    }
};

// =======================================================
// FUNGSI FILTER TABEL PI (REVISED)
// =======================================================
// =======================================================
// 1. FUNGSI FILTERING TABEL PI + AUTO HIGHLIGHT WARNA BOX
// =======================================================
window.filterTablePI = function() {
    const filterAsalEl = document.getElementById('filterInstansiAsalPI');
    const filterTujuanEl = document.getElementById('filterInstansiTujuanPI');
    const filterWilkerEl = document.getElementById('filterWilkerPI');
    const filterStatusEl = document.getElementById('filterStatusPI');

    const filterAsal = (filterAsalEl?.value || "").toLowerCase();
    const filterTujuan = (filterTujuanEl?.value || "").toLowerCase();
    const filterWilker = (filterWilkerEl?.value || "").toLowerCase();
    const filterStatus = (filterStatusEl?.value || "").toLowerCase();

    // --- LOGIKA PEWARNAAN BOX FILTER (TAMBAH / HAPUS CLASS filter-active) ---
    [filterAsalEl, filterTujuanEl, filterWilkerEl, filterStatusEl].forEach(el => {
        if (!el) return;
        if (el.value !== "") {
            el.classList.add('filter-active');
        } else {
            el.classList.remove('filter-active');
        }
    });

    // --- LOGIKA FILTERING DATA ---
    let dataToFilter = [];
    if (typeof rawPIData !== 'undefined' && Array.isArray(rawPIData)) {
        dataToFilter = rawPIData;
    } else if (typeof dbFetchedMap !== 'undefined' && dbFetchedMap) {
        dataToFilter = Object.keys(dbFetchedMap).map(k => ({ dbKey: k, ...dbFetchedMap[k] }));
    }

    const filteredData = dataToFilter.filter(item => {
        const instAsalBaku = (typeof standardizeInstansiName === 'function') 
            ? standardizeInstansiName(item.instansi_asal || "") 
            : (item.instansi_asal || "");

        const instTujuanBaku = (typeof standardizeInstansiName === 'function') 
            ? standardizeInstansiName(item.instansi_tujuan || "") 
            : (item.instansi_tujuan || "");

        const wilkerAuto = (typeof window.getAutomaticWilker === 'function')
            ? window.getAutomaticWilker(instAsalBaku, instTujuanBaku)
            : (item.wilker_prov || "");

        const currentStatus = (item.status === 'MS' ? 'ACC' : item.status || "").toLowerCase();

        const matchAsal = !filterAsal || instAsalBaku.toLowerCase() === filterAsal;
        const matchTujuan = !filterTujuan || instTujuanBaku.toLowerCase() === filterTujuan;
        const matchWilker = !filterWilker || wilkerAuto.toLowerCase() === filterWilker;
        const matchStatus = !filterStatus || currentStatus === filterStatus;

        return matchAsal && matchTujuan && matchWilker && matchStatus;
    });

    // Render Ulang Tabel dengan Hasil Filter
    if (typeof renderTablePI === 'function') {
        renderTablePI(filteredData);
    }
};

// =======================================================
// 2. FUNGSI RESET FILTER PI (MENGOSONGKAN SELURUH FILTER)
// =======================================================
window.resetFilterPI = function() {
    const filterAsalEl = document.getElementById('filterInstansiAsalPI');
    const filterTujuanEl = document.getElementById('filterInstansiTujuanPI');
    const filterWilkerEl = document.getElementById('filterWilkerPI');
    const filterStatusEl = document.getElementById('filterStatusPI');

    if (filterAsalEl) filterAsalEl.value = "";
    if (filterTujuanEl) filterTujuanEl.value = "";
    if (filterWilkerEl) filterWilkerEl.value = "";
    if (filterStatusEl) filterStatusEl.value = "";

    // Jalankan fungsi filter kembali untuk me-refresh data dan membersihkan warna box
    window.filterTablePI();
};

// Panggil inisialisasi awal saat dokumen siap
document.addEventListener('DOMContentLoaded', () => {
    window.renderInstansiDatalist();
});

// RENDER TABEL DI DALAM MODAL MASTER INSTANSI
window.renderMasterInstansiTable = function() {
    const tbody = document.getElementById('tbodyMasterInstansi');
    if (!tbody) return;

    if (masterInstansiData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; padding: 12px; color: #94a3b8;">Belum ada data master instansi.</td></tr>`;
        return;
    }

    tbody.innerHTML = masterInstansiData.map((item, index) => `
        <tr>
            <td style="padding: 7px 10px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #1e293b;">${item.name}</td>
            <td style="padding: 7px 10px; border-bottom: 1px solid #e2e8f0;">
                <span style="font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; background: #e0f2fe; color: #0369a1;">${item.wilker}</span>
            </td>
            <td style="padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: center;">
                <button type="button" onclick="deleteMasterInstansi(${index})" style="background: #fee2e2; border: 1px solid #fca5a5; color: #dc2626; border-radius: 4px; padding: 2px 8px; font-size: 11px; font-weight: bold; cursor: pointer;" title="Hapus Instansi">Hapus</button>
            </td>
        </tr>
    `).join('');
};

// FUNGSI BUKA MODAL MASTER INSTANSI
window.openModalMasterInstansi = function() {
    const modalWrapper = document.getElementById('modalMasterInstansi');
    if (modalWrapper) {
        modalWrapper.style.display = 'flex';
        
        const modalContent = modalWrapper.querySelector('.modal-content');
        if (modalContent) {
            modalContent.style.display = 'flex';
        }

        // Kunci Scroll Layar Utama/Body agar tidak bisa di-scroll saat modal terbuka
        document.body.style.overflow = 'hidden';

        // Render data tabel master instansi
        window.renderMasterInstansiTable();
    }
};

// FUNGSI TUTUP MODAL MASTER INSTANSI
window.closeModalMasterInstansi = function() {
    const modalWrapper = document.getElementById('modalMasterInstansi');
    if (modalWrapper) {
        modalWrapper.style.display = 'none';
        
        const modalContent = modalWrapper.querySelector('.modal-content');
        if (modalContent) {
            modalContent.style.display = 'none';
        }

        // Kembalikan Scroll Layar Utama/Body ke normal
        document.body.style.overflow = 'auto';
    }
};

// EVENT LISTENER: TUTUP MODAL SAAT KLIK AREA HITAM TRANSPARAN (DILUAR KOTAK MODAL)
document.addEventListener('DOMContentLoaded', () => {
    const modalMaster = document.getElementById('modalMasterInstansi');
    if (modalMaster) {
        modalMaster.addEventListener('click', function(event) {
            // Jika yang diklik adalah wrapper/backdrop (bukan bagian dalam modal-content)
            if (event.target === this) {
                window.closeModalMasterInstansi();
            }
        });
    }
});

// FUNGSI HAPUS ITEM MASTER INSTANSI
window.deleteMasterInstansi = function(index) {
    if (confirm(`Hapus "${masterInstansiData[index].name}" dari master data?`)) {
        masterInstansiData.splice(index, 1);
        localStorage.setItem('master_instansi_pi', JSON.stringify(masterInstansiData));
        window.renderMasterInstansiTable();
        window.renderInstansiDatalist();
    }
};

// Helper Function untuk Mengubah Teks Menjadi Capital Each Word (Title Case)
function toTitleCase(str) {
    if (!str) return '';
    return str.toLowerCase().split(' ').map(word => {
        if (!word) return '';
        // Menjaga penulisan singkatan khusus seperti Kab. atau KTP
        if (word === 'kab.' || word === 'kabupaten') return 'Kab.';
        if (word === 'prov.' || word === 'provinsi') return 'Provinsi';
        if (word === 'dan') return 'dan';
        if (word === 'atau') return 'atau';
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

// EVENT LISTENER TAMBAH MASTER INSTANSI BARU (MODAL)
document.addEventListener('DOMContentLoaded', () => {
    const formAddMaster = document.getElementById('formAddMasterInstansi');
    if (formAddMaster) {
        formAddMaster.addEventListener('submit', function(e) {
            e.preventDefault();
            const inputName = document.getElementById('newMasterInstansiName');
            const selectWilker = document.getElementById('newMasterInstansiWilker');

            if (!inputName || !selectWilker) return;

            // UBAH DARI .toUpperCase() MENJADI toTitleCase()
            const nameValue = toTitleCase(inputName.value.trim());
            const wilkerValue = selectWilker.value;

            // Cek Duplikasi (Bandingkan secara Case-Insensitive)
            const exists = masterInstansiData.some(item => item.name.toUpperCase() === nameValue.toUpperCase());
            if (exists) {
                alert('Nama instansi ini sudah ada di dalam daftar master!');
                return;
            }

            // Tambahkan ke Array & Simpan ke LocalStorage
            masterInstansiData.push({ name: nameValue, wilker: wilkerValue });
            localStorage.setItem('master_instansi_pi', JSON.stringify(masterInstansiData));

            // Reset Input & Render Ulang UI
            inputName.value = '';
            window.renderMasterInstansiTable();
            window.renderInstansiDatalist();
        });
    }
});


// ==========================================
// 11. EXPORT TO EXCEL / CLIPBOARD COPY
// ==========================================
window.copyAnyTable = function(tableId) {
    const table = document.getElementById(tableId);
    if (!table) {
        alert("⚠️ Tabel tidak ditemukan.");
        return;
    }

    const clonedTable = table.cloneNode(true);

    clonedTable.querySelectorAll('tbody tr td').forEach(cell => {
        let text = cell.innerText.replace(/\r?\n|\r/g, " ").trim();
        const cleanDigits = text.replace(/\s+/g, '');
        if (/^\d{18}$/.test(cleanDigits)) {
            cell.innerText = `'${cleanDigits}`;
        }
    });

    const htmlString = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; }
                th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: center; }
                th { background-color: #0f172a; color: #ffffff; font-weight: bold; }
                tfoot tr { background-color: #f8fafc; font-weight: bold; }
            </style>
        </head>
        <body>
            ${clonedTable.outerHTML}
        </body>
        </html>
    `;

    let plainTextRows = [];
    clonedTable.querySelectorAll('tr').forEach(tr => {
        let rowCols = [];
        tr.querySelectorAll('th, td').forEach(cell => {
            rowCols.push(cell.innerText.replace(/\r?\n|\r/g, " ").trim());
        });
        if (rowCols.length > 0) plainTextRows.push(rowCols.join('\t'));
    });
    const plainTextString = plainTextRows.join('\n');

    if (navigator.clipboard && window.ClipboardItem) {
        const blobHtml = new Blob([htmlString], { type: 'text/html' });
        const blobText = new Blob([plainTextString], { type: 'text/plain' });

        const data = new ClipboardItem({
            'text/html': blobHtml,
            'text/plain': blobText
        });

        navigator.clipboard.write([data]).then(() => {
            alert("✅ Tabel Laporan berhasil disalin! Silakan Paste (Ctrl+V) di Excel.");
        }).catch(err => {
            console.error("Gagal copy HTML clipboard:", err);
            fallbackCopyText(plainTextString);
        });
    } else {
        fallbackCopyText(plainTextString);
    }
};

function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        alert("✅ Tabel Data berhasil disalin! Silakan Paste (Ctrl+V) di Excel.");
    } catch (e) {
        alert("❌ Gagal menyalin tabel.");
    }
    document.body.removeChild(textarea);
}

window.copyDetailSummaryTableClean = function() { window.copyAnyTable('summaryExportTable'); }; 
window.copyInstansiTableClean = function() { window.copyAnyTable('tabelRekapInstansi'); };

function updateFilterActiveState() {
    const filterIds = [
        'filterInstansi', 'filterPeriodeKP', 'filterKategori', 'filterJenisKP',
        'dashFilterInstansi', 'dashFilterPeriodeKP', 'dashDateFrom', 'dashDateTo'
    ];

    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (el.value && el.value.trim() !== '') {
                el.classList.add('filter-active');
            } else {
                el.classList.remove('filter-active');
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const filterIds = [
        'filterInstansi', 'filterPeriodeKP', 'filterKategori', 'filterJenisKP',
        'dashFilterInstansi', 'dashFilterPeriodeKP', 'dashDateFrom', 'dashDateTo'
    ];

    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', updateFilterActiveState);
            el.addEventListener('input', updateFilterActiveState);
        }
    });
});

window.resetMainFilters = function(e) {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    const filterIds = ['filterInstansi', 'filterPeriodeKP', 'filterKategori', 'filterJenisKP'];

    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.value = ''; 
            el.dispatchEvent(new Event('change'));
        }
    });

    if (typeof window.renderTable === 'function') {
        window.renderTable();
    } else if (typeof window.filterData === 'function') {
        window.filterData();
    } else {
        refreshAllDisplays(); 
    }
    
    if (typeof window.updateFilterActiveState === 'function') {
        window.updateFilterActiveState();
    }
};

// ==========================================
// 12. REKAP REGIONAL DASHBOARD EXPANDABLE
// ==========================================
const REGION_PAPUA_BARAT = ["Pemerintah Provinsi Papua Barat", "Pemerintah Kab. Fak-Fak", "Pemerintah Kab. Manokwari Selatan", "Pemerintah Kab. Manokwari", "Pemerintah Kab. Kaimana", "Pemerintah Kab. Teluk Wondama", "Pemerintah Kab. Teluk Bintuni", "Pemerintah Kab. Pegunungan Arfak"];
const REGION_PAPUA_BARAT_DAYA = ["Pemerintah Provinsi Papua Barat Daya", "Pemerintah Kab. Raja Ampat", "Pemerintah Kab. Tambrauw", "Pemerintah Kota Sorong", "Pemerintah Kab. Sorong", "Pemerintah Kab. Maybrat", "Pemerintah Kab. Sorong Selatan"];
const REGION_INSTANSI_VERTIKAL = ["Mahkamah Agung RI", "Kementerian Agama", "Kementerian Imigrasi dan Pemasyarakatan", "Kementrian Hukum", "Kementerian Agraria dan Tata Ruang/BPN", "Kementerian Keuangan", "Badan Karantina Indonesia", "Kepolisian RI", "Kementerian Hak Asasi Manusia", "Badan Pemeriksa Keuangan", "Badan Pengawasan Keuangan dan Pembangunan"];

window.toggleRekapRegionSection = function(sectionId) {
    const targetSection = document.getElementById(sectionId); 
    if (!targetSection) return;
    
    const isCurrentlyOpen = targetSection.classList.contains('is-open');
    document.querySelectorAll('.rekap-region-expandable').forEach(sec => sec.classList.remove('is-open'));

    if (!isCurrentlyOpen) {
        renderAllRegionalTables(window.currentDashboardFilteredData || combinedDataList.filter(i => window.isEligibleForApp(i)));
        targetSection.classList.add('is-open');
        setTimeout(() => targetSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
    }
};

function getExportHeaderDateText(dataToProcess) {
    try {
        const elPeriode = document.getElementById('dashFilterPeriodeKP')?.value;
        const dateFrom = document.getElementById('dashDateFrom')?.value;
        const dateTo = document.getElementById('dashDateTo')?.value;

        const formatTgl = (str) => {
            if (!str || str === '--') return '';
            const parts = str.split('-');
            if (parts.length !== 3) return str;
            const [y, m, d] = parts;
            return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] || ''} ${y}`;
        };

        const wrapDateColor = (text) => `<span class="rekap-header-date-span">(${text})</span>`;

        const months = [
            "Januari", "Februari", "Maret", "April", "Mei", "Juni", 
            "Juli", "Agustus", "September", "Oktober", "November", "Desember"
        ];

        const getPeriodeKPFromDate = (dateStr) => {
            if (!dateStr || dateStr === '--') return null;
            
            // Parsing format YYYY-MM-DD (Contoh: "2026-08-15")
            const parts = dateStr.split('-');
            if (parts.length !== 3) return null;
            
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10); // Agustus = 8
            const day = parseInt(parts[2], 10);   // 15
            
            // LOGIKA REVISI PERIODE KP:
            // jika tgl < 16  : Masuk Periode Bulan Berikutnya (+1 dari bulan usul)
            // jika tgl >= 16 : Masuk Periode 2 Bulan Berikutnya (+2 dari bulan usul)
            let targetMonthIdx = (day >= 16) ? (month - 1) + 2 : (month - 1) + 1;
            
            let finalYear = year + Math.floor(targetMonthIdx / 12);
            let finalMonthIdx = (targetMonthIdx % 12 + 12) % 12;

            return {
                label: `${months[finalMonthIdx].toUpperCase()} ${finalYear}`,
                year: finalYear,
                monthIdx: finalMonthIdx
            };
        };
        
        const validDates = (Array.isArray(dataToProcess) ? dataToProcess : [])
            .map(i => i.tgl_pengiriman_kelayanan)
            .filter(d => d && d !== '--')
            .sort();

        const earliestDataDate = validDates.length > 0 ? validDates[0] : null;
        const latestDataDate = validDates.length > 0 ? validDates[validDates.length - 1] : null;

        if (dateFrom || dateTo) {
            const startDateStr = dateFrom || earliestDataDate;
            const endDateStr = dateTo || latestDataDate;

            if (startDateStr && endDateStr) {
                const startPeriodeObj = getPeriodeKPFromDate(startDateStr);
                const endPeriodeObj = getPeriodeKPFromDate(endDateStr);

                const uniquePeriodes = [];
                if (startPeriodeObj && endPeriodeObj) {
                    let curY = startPeriodeObj.year;
                    let curM = startPeriodeObj.monthIdx;
                    const endY = endPeriodeObj.year;
                    const endM = endPeriodeObj.monthIdx;

                    while (curY < endY || (curY === endY && curM <= endM)) {
                        uniquePeriodes.push(`${months[curM].toUpperCase()} ${curY}`);
                        curM++;
                        if (curM > 11) {
                            curM = 0;
                            curY++;
                        }
                    }
                }

                const periodeLabelText = uniquePeriodes.length > 0 ? uniquePeriodes.join(', ') : (startPeriodeObj ? startPeriodeObj.label : '');
                const rangeTglText = `${formatTgl(startDateStr)} - ${formatTgl(endDateStr)}`;
                return `🗓️ PERIODE: ${periodeLabelText} ${wrapDateColor(rangeTglText)}`;
            }
        }

        if (elPeriode && elPeriode.trim() !== '') {
            const parts = elPeriode.trim().split(' ');
            const namaBulanMap = {
                "JANUARI": 0, "FEBRUARI": 1, "MARET": 2, "APRIL": 3, "MEI": 4, "JUNI": 5,
                "JULI": 6, "AGUSTUS": 7, "SEPTEMBER": 8, "OKTOBER": 9, "NOVEMBER": 10, "DESEMBER": 11
            };

            const targetBulanStr = parts[0] ? parts[0].toUpperCase() : '';
            if (namaBulanMap[targetBulanStr] !== undefined) {
                let mIdx = namaBulanMap[targetBulanStr];
                let year = parts.length > 1 ? parseInt(parts[1], 10) : new Date().getFullYear();

                let startMIdx = mIdx - 2;
                let startYear = year;
                if (startMIdx < 0) { startMIdx += 12; startYear -= 1; }

                let endMIdx = mIdx - 1;
                let endYear = year;
                if (endMIdx < 0) { endMIdx += 12; endYear -= 1; }

                const rangeTglText = `16 ${months[startMIdx]} ${startYear} - 15 ${months[endMIdx]} ${endYear}`;
                return `🗓️ PERIODE: ${elPeriode.trim().toUpperCase()} ${wrapDateColor(rangeTglText)}`;
            }
        }

        if (earliestDataDate && latestDataDate) {
            const minYear = earliestDataDate.split('-')[0];
            const maxYear = latestDataDate.split('-')[0];
            const yearRangeText = (minYear === maxYear) ? minYear : `${minYear} - ${maxYear}`;
            const rangeTglText = `${formatTgl(earliestDataDate)} s/d ${formatTgl(latestDataDate)}`;
            return `🗓️ RENTANG PERIODE: TAHUN ${yearRangeText} ${wrapDateColor(rangeTglText)}`;
        }

    } catch (e) {
        console.error("Gagal membentuk teks tanggal export header:", e);
    }
    return `🗓️ Semua Data Usulan KP`;
}

window.renderAllRegionalTables = function(targetDataList) {
    const dataToProcess = Array.isArray(window.currentDashboardFilteredData) && window.currentDashboardFilteredData.length > 0
        ? window.currentDashboardFilteredData
        : (combinedDataList ? combinedDataList.filter(i => window.isEligibleForApp(i)) : []);
    
    const dateTextHtml = getExportHeaderDateText(dataToProcess);

    ['exportDateTextPB', 'exportDateTextPBD', 'exportDateTextVert'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = dateTextHtml; 
    });

    const instansiStatsMap = {};
    dataToProcess.forEach(item => {
        const fullInst = item.instansi_induk;
        if (!fullInst || fullInst === '--') return;
        
        const cleanName = cleanInstansiName(fullInst);
        if (!instansiStatsMap[cleanName]) {
            instansiStatsMap[cleanName] = { inbox: 0, bts: 0, tms: 0, sudahTtd: 0, menungguTtd: 0 };
        }

        const statusUsulanRaw = String(item.status_usulan || '').trim();
        const statusLower = statusUsulanRaw.toLowerCase();
        const katStatus = categoriseStatus(statusUsulanRaw);

        if (katStatus === 'Inbox') {
            instansiStatsMap[cleanName].inbox++;
        } else if (katStatus === 'BTS') {
            instansiStatsMap[cleanName].bts++;
        } else if (katStatus === 'TMS') {
            instansiStatsMap[cleanName].tms++;
        } else if (katStatus === 'MS') {
            if (statusLower.includes('menunggu ttd pertek') || statusLower === 'menunggu ttd') {
                instansiStatsMap[cleanName].menungguTtd++;
            } else {
                instansiStatsMap[cleanName].sudahTtd++;
            }
        }
    });

    function populateRegionTable(tbodyId, tfootId, instansiList) {
        const tbody = document.getElementById(tbodyId);
        const tfoot = document.getElementById(tfootId);
        
        if (!tbody) return;
        tbody.innerHTML = '';
        if (tfoot) tfoot.innerHTML = '';

        let sumBerkasMasuk = 0, sumInbox = 0, sumTotalValidasi = 0, sumMs = 0, sumBts = 0, sumTms = 0, sumMenungguTtd = 0, sumSudahTtd = 0;

        instansiList.forEach((instName, idx) => {
            const stats = instansiStatsMap[cleanInstansiName(instName)] || { inbox: 0, bts: 0, tms: 0, sudahTtd: 0, menungguTtd: 0 };
            
            const ms = stats.sudahTtd + stats.menungguTtd;
            const totalValidasi = ms + stats.bts + stats.tms;
            const berkasMasuk = stats.inbox + totalValidasi;

            sumBerkasMasuk += berkasMasuk;
            sumInbox += stats.inbox;
            sumTotalValidasi += totalValidasi;
            sumMs += ms;
            sumBts += stats.bts;
            sumTms += stats.tms;
            sumMenungguTtd += stats.menungguTtd;
            sumSudahTtd += stats.sudahTtd;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center;">${idx + 1}</td>
                <td style="text-align: left; padding-left: 6px;"><strong>${instName}</strong></td>
                <td style="text-align: center; font-weight: 800; color: #0f172a;">${berkasMasuk}</td>
                <td style="text-align: center; color: #2563eb; font-weight: bold;">${stats.inbox}</td>
                <td style="text-align: center; font-weight: 800; color: #0f172a;">${totalValidasi}</td>
                <td style="text-align: center; color: #16a34a; font-weight: 800;">${ms}</td>
                <td style="text-align: center; color: #d97706; font-weight: 800;">${stats.bts}</td>
                <td style="text-align: center; color: #dc2626; font-weight: 800;">${stats.tms}</td>
                <td style="text-align: center;">${stats.menungguTtd}</td>
                <td style="text-align: center; color: #0284c7; font-weight: 800;">${stats.sudahTtd}</td>
            `;
            tbody.appendChild(tr);
        });

        if (tfoot) {
            tfoot.innerHTML = `
                <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #cbd5e1;">
                    <td colspan="2" style="text-align: right !important; padding-right: 10px; color: #0f172a;">TOTAL KESELURUHAN:</td>
                    <td style="text-align: center !important; color: #0f172a;">${sumBerkasMasuk}</td>
                    <td style="text-align: center !important; color: #2563eb;">${sumInbox}</td>
                    <td style="text-align: center !important; color: #0f172a;">${sumTotalValidasi}</td>
                    <td style="text-align: center !important; color: #16a34a;">${sumMs}</td>
                    <td style="text-align: center !important; color: #d97706;">${sumBts}</td>
                    <td style="text-align: center !important; color: #dc2626;">${sumTms}</td>
                    <td style="text-align: center !important;">${sumMenungguTtd}</td>
                    <td style="text-align: center !important; color: #0284c7;">${sumSudahTtd}</td>
                </tr>
            `;
        }
    }

    populateRegionTable('tbody-papua-barat', 'tfoot-papua-barat', REGION_PAPUA_BARAT);
    populateRegionTable('tbody-papua-barat-daya', 'tfoot-papua-barat-daya', REGION_PAPUA_BARAT_DAYA);
    populateRegionTable('tbody-instansi-vertikal', 'tfoot-instansi-vertikal', REGION_INSTANSI_VERTIKAL);
};


// ==========================================
// 13. GENERATE PDF PRINT NATIVE
// ==========================================
window.previewLaporanPDF = function(customHeaderBg = '#0d1220', customHeaderColor = '#ffffff') {
    const btn = event ? event.currentTarget : null, originalText = btn ? btn.innerHTML : '';
    const tbodyPB = document.getElementById('tbody-papua-barat'), tfootPB = document.getElementById('tfoot-papua-barat');
    const tbodyPBD = document.getElementById('tbody-papua-barat-daya'), tfootPBD = document.getElementById('tfoot-papua-barat-daya');
    const tbodyVert = document.getElementById('tbody-instansi-vertikal'), tfootVert = document.getElementById('tfoot-instansi-vertikal');

    if ((!tbodyPB || tbodyPB.children.length === 0) && (!tbodyPBD || tbodyPBD.children.length === 0) && (!tbodyVert || tbodyVert.children.length === 0)) { 
        alert("⚠️ Data tabel rekapitulasi masih kosong."); 
        return; 
    }

    if (btn) { 
        btn.innerHTML = `<span class="spinner-pdf" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memproses PDF...`; 
        btn.disabled = true; 
    }

    const overlay = document.createElement('div'); 
    overlay.className = 'pdf-loading-overlay';
    overlay.innerHTML = `<div class="pdf-spinner"></div><div style="font-weight: 700; font-size: 15px;">Menyiapkan Dokumen PDF Laporan KP...</div><div style="font-size: 12px; color: #94a3b8; margin-top: 5px;">Mohon tunggu sebentar, membuka preview di tab baru...</div>`;
    document.body.appendChild(overlay);

    const now = new Date(), utc = now.getTime() + (now.getTimezoneOffset() * 60000), witDate = new Date(utc + (3600000 * 9));
    const day = String(witDate.getDate()).padStart(2, '0'), month = NAMA_BULAN[witDate.getMonth()], year = witDate.getFullYear(), hours = String(witDate.getHours()).padStart(2, '0'), minutes = String(witDate.getMinutes()).padStart(2, '0');
    const headerTglStr = `DATA PER ${day} ${month.toUpperCase()} ${year} PUKUL ${hours}.${minutes} WIT`;

    const activeDataList = Array.isArray(window.currentDashboardFilteredData) && window.currentDashboardFilteredData.length > 0
        ? window.currentDashboardFilteredData
        : (combinedDataList ? combinedDataList.filter(i => window.isEligibleForApp(i)) : []);

    const selectedPeriode = document.getElementById('dashFilterPeriodeKP')?.value;
    let judulPeriodeStr = "";
    const months = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

    const getPeriodeKPObj = (dateStr) => {
        if (!dateStr || dateStr === '--') return null;
        const parts = dateStr.split('-');
        if (parts.length !== 3) return null;
        const y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
        let targetMIdx = (d >= 16) ? (m - 1) + 2 : (m - 1) + 1;
        let finalY = y + Math.floor(targetMIdx / 12);
        let finalMIdx = targetMIdx % 12;
        return { label: `${months[finalMIdx]} ${finalY}`, year: finalY, monthIdx: finalMIdx };
    };

    if (selectedPeriode && selectedPeriode.trim() !== '') {
        judulPeriodeStr = `PERIODE ${selectedPeriode.trim().toUpperCase()}`;
    } else {
        const validDates = activeDataList.map(i => i.tgl_pengiriman_kelayanan).filter(d => d && d !== '--').sort();
        if (validDates.length > 0) {
            const startObj = getPeriodeKPObj(validDates[0]);
            const endObj = getPeriodeKPObj(validDates[validDates.length - 1]);
            if (startObj && endObj) {
                if (startObj.label === endObj.label) {
                    judulPeriodeStr = `PERIODE ${startObj.label}`;
                } else {
                    judulPeriodeStr = `PERIODE ${startObj.label} - ${endObj.label}`;
                }
            }
        } else {
            const dateFormatted = `${witDate.getFullYear()}-${String(witDate.getMonth() + 1).padStart(2, '0')}-${String(witDate.getDate()).padStart(2, '0')}`;
            const computedPeriode = calculatePeriodeKP(dateFormatted);
            judulPeriodeStr = `PERIODE ${computedPeriode !== '--' ? computedPeriode.toUpperCase() : month.toUpperCase() + ' ' + year}`;
        }
    }

    let subJudulDateStr = "";
    if (typeof getExportHeaderDateText === 'function') {
        const rawDateText = getExportHeaderDateText(activeDataList);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = rawDateText;
        subJudulDateStr = tempDiv.textContent || tempDiv.innerText || "";
    }

    const generatePageHtml = (namaWilayah, tbodyEl, tfootEl) => {
        const tbodyContent = tbodyEl ? tbodyEl.innerHTML : '<tr><td colspan="10" style="text-align:center;">Data tidak tersedia</td></tr>';
        const tfootContent = (tfootEl && tfootEl.innerHTML.trim() !== '') ? `<tfoot class="tfoot-total-double">${tfootEl.innerHTML}</tfoot>` : '';
        
        return `
            <div class="pdf-page">
                <div class="header-container">
                    <div class="header-title">LAPORAN PROGRES USULAN KENAIKAN PANGKAT</div>
                    <div class="header-title">WILAYAH KERJA KANTOR REGIONAL XIV BKN MANOKWARI</div>
                    <div class="header-subtitle-range"></div>
                    <div class="header-subtitle">${subJudulDateStr}</div>
                    <div class="header-date"><br>${headerTglStr}</div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th style="width: 4%;">No</th>
                            <th style="width: 28%; text-align: left; padding-left: 5px;">Instansi</th>
                            <th style="width: 8.5%;">Berkas Masuk</th>
                            <th style="width: 8.5%;">Approval Usulan (Inbox)</th>
                            <th style="width: 8.5%;">Total Validasi</th>
                            <th style="width: 8.5%; color: #86efac;">MS</th>
                            <th style="width: 8.5%; color: #fde047;">BTS</th>
                            <th style="width: 8.5%; color: #fca5a5;">TMS</th>
                            <th style="width: 8.5%;">Menunggu TTD Pertek</th>
                            <th style="width: 8.5%; color: #7dd3fc;">Sudah TTD Pertek</th>
                        </tr>
                    </thead>
                    <tbody>${tbodyContent}</tbody>
                    ${tfootContent}
                </table>

                <div class="signature-box">
                    <div class="signature-content">
                        <p style="margin: 0 0 45px 0;">
                            Manokwari, ${day} ${month} ${year}<br>
                            <br><strong>Tim Pengangkatan dan Mutasi</strong>
                        </p>
                        <p style="margin: 0; font-weight: bold; text-decoration: underline;"></p>
                    </div>
                </div>
            </div>
        `;
    };

    setTimeout(() => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) { 
            alert("⚠️ Pop-up diblokir oleh browser."); 
            if (document.body.contains(overlay)) document.body.removeChild(overlay); 
            if (btn) { btn.innerHTML = originalText; btn.disabled = false; } 
            return; 
        }
        
        const page1Html = generatePageHtml("PROVINSI PAPUA BARAT", tbodyPB, tfootPB);
        const page2Html = generatePageHtml("PROVINSI PAPUA BARAT DAYA", tbodyPBD, tfootPBD);
        const page3Html = generatePageHtml("INSTANSI VERTIKAL", tbodyVert, tfootVert);

        printWindow.document.write(`<!DOCTYPE html><html><head><title>Laporan KP Updated per ${day}-${month}-${year} ${hours}.${minutes} WIT</title><style>@page { size: A4 landscape; margin: 8mm; } body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .pdf-page { padding: 5px 8px; page-break-after: always; break-after: page; box-sizing: border-box; } .pdf-page:last-child { page-break-after: auto; break-after: auto; } .header-container { text-align: center; margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 6px; } .header-title { margin: 0 0 2px 0; font-size: 11pt; font-weight: 800; text-transform: uppercase; } .header-subtitle-range { margin: 0 0 4px 0; font-size: 8.5pt; font-weight: 700; color: #000; } .header-subtitle { margin: 0 0 2px 0; font-size: 9pt; font-weight: 700; text-transform: uppercase; } .header-date { margin: 0; font-size: 7.5pt; font-weight: 700; color: #333; } table { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-top: 6px; } th, td { border: 1px solid #000 !important; padding: 4px 2px; text-align: center; word-wrap: break-word; } th { background-color: ${customHeaderBg} !important; color: ${customHeaderColor} !important; font-weight: bold; font-size: 7.5pt; } td.instansi-cell { text-align: left !important; padding-left: 5px; } tfoot.tfoot-total-double tr td { background-color: #f8fafc !important; font-weight: bold !important; border-top: 3px double #000 !important; border-bottom: 2px solid #000 !important; color: #000 !important; } .signature-box { margin-top: 20px; display: flex; justify-content: flex-end; } .signature-content { text-align: center; font-size: 8pt; }</style></head><body>${page1Html}${page2Html}${page3Html}</body></html>`);
        printWindow.document.close();
        printWindow.document.querySelectorAll('tbody tr').forEach(r => { const tdInst = r.children[1]; if (tdInst) tdInst.className = 'instansi-cell'; });
        
        if (document.body.contains(overlay)) document.body.removeChild(overlay); 
        if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
        printWindow.focus(); 
        printWindow.print();
    }, 2000);
};

// ==========================================
// 14. JAM DIGITAL DAN MOTIVASI
// ==========================================
const MOTIVASI_LIST = [
    "Setiap usulan yang Anda selesaikan adalah bentuk pelayanan terbaik bagi pegawai!", 
    "Bekerja dengan cermat, teliti, dan penuh tanggung jawab!", 
    "Semangat memberi dampak positif dalam pelayanan tamu hari ini!", 
    "Koordinasi yang baik adalah kunci kelancaran setiap usul naik pangkat!", 
    "Fokus bersinergi dan melayani dengan sepenuh hati!"
];

function toCapitalEachWord(str) { 
    if (!str) return ''; 
    return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '); 
}

function updateWelcomeHeader(userName) {
    const titleEl = document.getElementById('welcomeTitle'), quoteEl = document.getElementById('welcomeQuote'), formattedName = toCapitalEachWord(userName || 'Rekan Pelayanan');
    if (titleEl) titleEl.innerText = `Selamat Datang,\n${formattedName}! 👋`; 
    if (quoteEl) quoteEl.innerText = MOTIVASI_LIST[Math.floor(Math.random() * MOTIVASI_LIST.length)];
}

function startDigitalClockWIT() {
    function updateClock() {
        const now = new Date(), utc = now.getTime() + (now.getTimezoneOffset() * 60000), witDate = new Date(utc + (3600000 * 9));
        const hours = String(witDate.getHours()).padStart(2, '0'), minutes = String(witDate.getMinutes()).padStart(2, '0'), seconds = String(witDate.getSeconds()).padStart(2, '0');
        const dayName = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][witDate.getDay()], dateFull = `${dayName}, ${witDate.getDate()} ${NAMA_BULAN[witDate.getMonth()]} ${witDate.getFullYear()}`, dateShort = `${witDate.getDate()} ${NAMA_BULAN[witDate.getMonth()].substring(0, 3)} ${witDate.getFullYear()}`;
        
        if (document.getElementById('clockDate')) document.getElementById('clockDate').innerText = dateFull; 
        if (document.getElementById('clockHours')) document.getElementById('clockHours').innerText = hours; 
        if (document.getElementById('clockMinutes')) document.getElementById('clockMinutes').innerText = minutes; 
        if (document.getElementById('clockSeconds')) document.getElementById('clockSeconds').innerText = seconds;
        
        ['KP', 'PI','DSHB'].forEach(mod => { 
            if (document.getElementById(`clockDate${mod}`)) document.getElementById(`clockDate${mod}`).innerText = dateShort; 
            if (document.getElementById(`clockHours${mod}`)) document.getElementById(`clockHours${mod}`).innerText = hours; 
            if (document.getElementById(`clockMinutes${mod}`)) document.getElementById(`clockMinutes${mod}`).innerText = minutes; 
            if (document.getElementById(`clockSeconds${mod}`)) document.getElementById(`clockSeconds${mod}`).innerText = seconds; 
        });
    } 
    setInterval(updateClock, 1000); 
    updateClock();
}

// Listener Tutup Modal Umum (Klik Luar Backdrop)
['rekapAngkaModal', 'rekapInstansiModal', 'summaryTableModal', 'previewModal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', function(e) { 
        if (e.target === this) this.style.display = 'none'; 
    });
});

