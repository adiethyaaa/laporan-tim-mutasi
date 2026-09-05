import { NAMA_BULAN } from "../../config/constants.js";
import { toCapitalEachWord } from "../../utils/formatters.js";
import { state } from "../../services/store.js";

const MOTIVASI_LIST = [
    "Setiap usulan yang Anda selesaikan adalah bentuk pelayanan terbaik bagi pegawai!", 
    "Bekerja dengan cermat, teliti, dan penuh tanggung jawab!", 
    "Semangat memberi dampak positif dalam pelayanan tamu hari ini!", 
    "Koordinasi yang baik adalah kunci kelancaran setiap usul naik pangkat!", 
    "Fokus bersinergi dan melayani dengan sepenuh hati!"
];

export function injectDynamicFavicon() {
    let link = document.querySelector("link[rel*='icon']");
    if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%230f172a"/><text x="50%" y="55%" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-weight="900" font-size="28" fill="%2338bdf8">KR14</text></svg>';
}

export function showSection(sectionId, moduleName = null) {
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

    // Tentukan target modul
    let targetMod = moduleName;
    if (!targetMod) {
        if (sectionId === 'aplikasi-3-PI') targetMod = 'PI';
        else if (sectionId === 'aplikasi-2-PGA') targetMod = 'PGA';
        else if (sectionId === 'aplikasi-1-KP' || sectionId === 'dashboard') targetMod = 'KP';
    }

    if (targetMod) {
        const modChanged = (state.currentModule !== targetMod);
        state.currentModule = targetMod;
        window.currentModule = targetMod;

        if (modChanged) {
            if (typeof window.loadDatabaseData === 'function') {
                window.loadDatabaseData();
            }
        } else {
            if (typeof window.refreshAllDisplays === 'function') {
                window.refreshAllDisplays();
            }
        }
    }
}

export function setupSidebarToggle() {
    const s = document.getElementById('sidebarContainer');
    const m = document.getElementById('mainContent');
    const b = document.getElementById('sidebarMobileBackdrop');
    const btn = document.getElementById('btnToggleSidebar');
    const btnHamburger = document.getElementById('btnMobileHamburger');
    if (!s || !m) return;
    
    s.classList.add('collapsed'); 
    m.classList.add('expanded');
    
    const tog = () => { 
        s.classList.toggle('collapsed'); 
        m.classList.toggle('expanded'); 
        if (btn) btn.innerText = s.classList.contains('collapsed') ? '➕' : '❌'; 
        if (window.innerWidth <= 768 && b) { 
            b.classList.toggle('active', !s.classList.contains('collapsed')); 
        } 
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300); 
    };
    
    if (btn) btn.onclick = e => { e.preventDefault(); e.stopPropagation(); tog(); };
    if (btnHamburger) btnHamburger.onclick = e => { e.preventDefault(); e.stopPropagation(); tog(); };
    if (b) { 
        b.onclick = () => { 
            s.classList.add('collapsed'); 
            b.classList.remove('active'); 
            if (btn) btn.innerText = '十'; 
        }; 
    }
    
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

export function updateWelcomeHeader(userName) {
    const titleEl = document.getElementById('welcomeTitle');
    const quoteEl = document.getElementById('welcomeQuote');
    const formattedName = toCapitalEachWord(userName || 'Rekan Pelayanan');
    if (titleEl) titleEl.innerText = `Selamat Datang,\n${formattedName}! 👋`; 
    if (quoteEl) quoteEl.innerText = MOTIVASI_LIST[Math.floor(Math.random() * MOTIVASI_LIST.length)];
}

export function startDigitalClockWIT() {
    function updateClock() {
        const now = new Date();
        const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
        const witDate = new Date(utc + (3600000 * 9));
        const hours = String(witDate.getHours()).padStart(2, '0');
        const minutes = String(witDate.getMinutes()).padStart(2, '0');
        const seconds = String(witDate.getSeconds()).padStart(2, '0');
        const dayName = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"][witDate.getDay()];
        const dateFull = `${dayName}, ${witDate.getDate()} ${NAMA_BULAN[witDate.getMonth()]} ${witDate.getFullYear()}`;
        const dateShort = `${witDate.getDate()} ${NAMA_BULAN[witDate.getMonth()].substring(0, 3)} ${witDate.getFullYear()}`;
        
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

// Pasang ke window agar onclick="showSection('...')" berfungsi
if (typeof window !== 'undefined') {
    window.showSection = showSection;
    window.setupSidebarToggle = setupSidebarToggle;
    window.updateWelcomeHeader = updateWelcomeHeader;
    window.startDigitalClockWIT = startDigitalClockWIT;
}
