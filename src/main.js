import { auth, db, get, ref, onAuthStateChanged, signOut } from "./services/firebase.js";
import { state } from "./services/store.js";
import { SESSION_TIMEOUT_MS } from "./config/constants.js";
import { 
    checkSessionExpiration, 
    resetSessionTimer, 
    setupActivityListeners, 
    setupLogoutHandlers 
} from "./modules/auth/session.js";
import { 
    injectDynamicFavicon, 
    showSection, 
    setupSidebarToggle, 
    updateWelcomeHeader, 
    startDigitalClockWIT 
} from "./modules/navigation/sidebar.js";
import { setupMasterInstansiForm, renderInstansiDatalist } from "./modules/master/masterInstansi.js";
import { setupPGAEventListeners } from "./modules/pga/pgaController.js";
import { initCharts } from "./modules/dashboard/charts.js";
import { updateFilterActiveState } from "./modules/dashboard/rekapModals.js";
import "./modules/reports/pdfExport.js";
import "./modules/pi/piController.js";
import { loadDatabaseData, refreshAllDisplays } from "./modules/kp/kpController.js";
import { 
    setupDragAndDrop, 
    setupToggleUploadForm, 
    setupKPUploadListeners 
} from "./modules/kp/kpUpload.js";
import { setupDragAndDropPI, setupPIUploadListeners } from "./modules/pi/piUpload.js";
import { 
    renderUserManagementTable, 
    setupAdminRegisterForm, 
    getColorForInitial 
} from "../admin.js";

// 0. Injeksi Favicon
document.addEventListener("DOMContentLoaded", injectDynamicFavicon);

// 1. Filter Input Listeners
document.addEventListener("DOMContentLoaded", () => {
    ['filterInstansi', 'filterPeriodeKP', 'filterKategori', 'filterJenisKP', 
     'filterInstansiAsalPI', 'filterInstansiTujuanPI', 'filterWilkerPI', 'filterStatusPI'].forEach(id => {
        const el = document.getElementById(id); 
        if (el) el.addEventListener('change', refreshAllDisplays);
    });

    ['dashFilterInstansi', 'dashFilterPeriodeKP', 'dashDateFrom', 'dashDateTo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', updateFilterActiveState);
            el.addEventListener('input', updateFilterActiveState);
        }
    });

    renderInstansiDatalist();
    setupMasterInstansiForm();
    setupPGAEventListeners();
    setupKPUploadListeners();
    setupPIUploadListeners();
    setupLogoutHandlers();
});

// 2. Autentikasi Pengguna & Inisialisasi Aplikasi
onAuthStateChanged(auth, async (user) => {
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

    localStorage.setItem('last_user_activity', Date.now().toString());
    
    document.querySelectorAll('.section').forEach(sec => { 
        sec.classList.remove('active'); 
        sec.style.display = 'none'; 
    });

    const sContainer = document.getElementById('sidebarContainer');
    const mContent = document.getElementById('mainContent');
    if (sContainer) sContainer.style.display = 'block'; 
    if (mContent) mContent.style.display = 'block';
    
    setupActivityListeners();
    resetSessionTimer();

    let namaUserDisplay = user.email;
    let targetSectionToOpen = 'profile-page';

    try {
        const snapshot = await get(ref(db, `users/${user.uid}`));
        const userData = snapshot.val();
        
        state.currentUserInitial = (userData && userData.id_inisial) ? userData.id_inisial.trim().toUpperCase() : '--';
        state.currentUserRole = (userData && userData.role) ? userData.role : 'User';
        state.currentUserAllowDelete = Boolean(userData?.allow_delete_selected);

        const isTrueAdminRole = (state.currentUserRole.toLowerCase() === 'admin');
        
        const adminUserMgmtArea = document.getElementById('adminUserManagementArea');
        if (adminUserMgmtArea) {
            adminUserMgmtArea.style.display = isTrueAdminRole ? 'block' : 'none';
        }

        if (userData?.nama) namaUserDisplay = userData.nama;
        const userAvatarEl = document.getElementById('sidebarUserAvatar');
        
        if (userAvatarEl) {
            const colorObj = getColorForInitial(state.currentUserInitial);
            userAvatarEl.innerText = state.currentUserInitial; 
            userAvatarEl.style.backgroundColor = colorObj.bg; 
            userAvatarEl.style.color = colorObj.color;
        }
        
        if (document.getElementById('sidebarUserEmail')) document.getElementById('sidebarUserEmail').innerText = namaUserDisplay;
        if (document.getElementById('sidebarUserRole')) document.getElementById('sidebarUserRole').innerText = state.currentUserRole;

        if (userData && userData.menus) {
            const menus = userData.menus;
            const canDashboard = Boolean(menus.dashboard);
            const canAccessKP = Boolean(menus.kp ?? menus.aplikasi);
            const canAccessPGA = Boolean(menus.pga ?? menus.aplikasi);
            const canAccessPI = Boolean(menus.pi ?? menus.aplikasi);
            const canAccessAdminMenu = isTrueAdminRole || Boolean(menus.admin);

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

    if (typeof window.setupChangePasswordForm === 'function') {
        window.setupChangePasswordForm();
    }

    showSection(targetSectionToOpen);
    updateWelcomeHeader(namaUserDisplay); 
    startDigitalClockWIT();
    setupSidebarToggle(); 
    initCharts(); 
    setupDragAndDrop(); 
    setupDragAndDropPI(); 
    setupToggleUploadForm();
    
    state.currentModule = 'KP'; 
    loadDatabaseData();
    
    if (state.currentUserRole.toLowerCase() === 'admin') {
        setupAdminRegisterForm(); 
        renderUserManagementTable();
    }
});
