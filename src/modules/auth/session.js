import { auth, signOut } from "../../services/firebase.js";
import { SESSION_TIMEOUT_MS } from "../../config/constants.js";

let sessionTimer = null;
let isLoggingOut = false;

export function checkSessionExpiration() {
    if (isLoggingOut) return false;

    const lastActivity = localStorage.getItem('last_user_activity');
    const now = Date.now();

    if (lastActivity && (now - parseInt(lastActivity, 10)) >= SESSION_TIMEOUT_MS) {
        triggerSessionExpired();
        return false;
    }
    return true;
}

export function resetSessionTimer() {
    if (isLoggingOut) return;
    
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

export async function triggerSessionExpired() {
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

export function setupActivityListeners() { 
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
        window.addEventListener(evt, resetSessionTimer, { passive: true });
    }); 

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkSessionExpiration();
        }
    });

    window.addEventListener('focus', () => {
        checkSessionExpiration();
    });
}

export function setupLogoutHandlers() {
    const logoutModalEl = document.getElementById('logoutModal');
    const btnTriggerLogout = document.getElementById('btnTriggerLogout');
    const btnConfirmLogout = document.getElementById('btnConfirmLogoutModal');
    const btnCancelLogout1 = document.getElementById('btnCancelLogoutModal');
    const btnCancelLogout2 = document.getElementById('btnCancelLogoutAction');

    if (btnTriggerLogout && logoutModalEl) { 
        btnTriggerLogout.addEventListener('click', (e) => { 
            e.preventDefault(); 
            logoutModalEl.style.display = 'flex'; 
            const innerCard = logoutModalEl.querySelector('.modal-content'); 
            if (innerCard) innerCard.style.display = 'block'; 
        }); 
    }

    const closeLogoutModal = () => { 
        if (logoutModalEl) logoutModalEl.style.display = 'none'; 
    };

    if (btnCancelLogout1) btnCancelLogout1.addEventListener('click', closeLogoutModal); 
    if (btnCancelLogout2) btnCancelLogout2.addEventListener('click', closeLogoutModal);
    
    logoutModalEl?.addEventListener('click', (e) => { 
        if (e.target === logoutModalEl) closeLogoutModal(); 
    });

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
}
