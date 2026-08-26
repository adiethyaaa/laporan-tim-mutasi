import { db, auth } from "./firebase-config.js";
import { ref, set, get, update, remove, onValue } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-database.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

let localUsersMap = {};

// ==========================================
// KONTROL MODAL UBAH PASSWORD
// ==========================================
window.openChangePasswordModal = function() {
    const modal = document.getElementById('modalChangePassword');
    const form = document.getElementById('formChangePassword');
    const statusDiv = document.getElementById('changePasswordStatus');
    
    if (form) form.reset();
    if (statusDiv) {
        statusDiv.style.display = 'none';
        statusDiv.innerHTML = '';
    }
    
    if (modal) {
        modal.style.display = 'flex';
    }
};

window.closeChangePasswordModal = function() {
    const modal = document.getElementById('modalChangePassword');
    if (modal) modal.style.display = 'none';
};

// HANDLER SUBMIT UBAH PASSWORD DENGAN SPINNER
// HANDLER EKSPLISIT PROSES UBAH PASSWORD
window.handleProcessChangePassword = async function() {
    const oldPass = document.getElementById('inputOldPassword').value.trim();
    const newPass = document.getElementById('inputNewPassword').value.trim();
    const confirmPass = document.getElementById('inputConfirmPassword').value.trim();
    const statusDiv = document.getElementById('changePasswordStatus');
    const btnSubmit = document.getElementById('btnSubmitChangePassword');
    const btnCancel = document.getElementById('btnCancelChangePassword');

    // Validasi Kolom Kosong
    if (!oldPass || !newPass || !confirmPass) {
        statusDiv.style.display = 'block';
        statusDiv.style.color = '#ef4444';
        statusDiv.innerText = "⚠️ Harap isi semua kolom password!";
        return;
    }

    // Validasi Minimal 6 Karakter
    if (newPass.length < 6) {
        statusDiv.style.display = 'block';
        statusDiv.style.color = '#ef4444';
        statusDiv.innerText = "⚠️ Password baru minimal harus 6 karakter!";
        return;
    }

    // Validasi Kesesuaian Password Baru & Konfirmasi
    if (newPass !== confirmPass) {
        statusDiv.style.display = 'block';
        statusDiv.style.color = '#ef4444';
        statusDiv.innerText = "⚠️ Password baru dan konfirmasi tidak cocok!";
        return;
    }

    if (oldPass === newPass) {
        statusDiv.style.display = 'block';
        statusDiv.style.color = '#ef4444';
        statusDiv.innerText = "⚠️ Password baru tidak boleh sama dengan password lama!";
        return;
    }

    // Tampilkan State Loading Spinner
    statusDiv.style.display = 'block';
    statusDiv.style.color = '#2563eb';
    statusDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Memverifikasi password lama...`;
    
    btnSubmit.disabled = true;
    btnCancel.disabled = true;

    try {
        const user = auth.currentUser;
        if (!user || !user.email) throw new Error("Sesi login tidak ditemukan, harap relogin!");

        // 1. Re-autentikasi User dengan Password Lama
        const credential = EmailAuthProvider.credential(user.email, oldPass);
        await reauthenticateWithCredential(user, credential);

        // 2. Update Status & Simpan Password Baru
        statusDiv.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Memperbarui password baru...`;
        await updatePassword(user, newPass);

        // 3. Tampilkan Pesan Sukses
        statusDiv.style.color = '#10b981';
        statusDiv.innerHTML = `✅ Password berhasil diubah!`;
        
        // Alert Notifikasi Berhasil
        alert("✅ Kata sandi Anda berhasil diperbarui! Silakan gunakan password baru ini pada login berikutnya.");

        setTimeout(() => {
            closeChangePasswordModal();
            btnSubmit.disabled = false;
            btnCancel.disabled = false;
        }, 1000);

    } catch (err) {
        statusDiv.style.color = '#ef4444';

        if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
            statusDiv.innerText = "⚠️ Password saat ini (lama) yang Anda masukkan salah!";
        } else if (err.code === 'auth/weak-password') {
            statusDiv.innerText = "⚠️ Kata sandi baru terlalu pendek (minimal 6 karakter)!";
        } else if (err.code === 'auth/too-many-requests') {
            statusDiv.innerText = "⚠️ Terlalu banyak percobaan. Silakan coba lagi nanti.";
        } else {
            statusDiv.innerText = "⚠️ Gagal: " + err.message;
        }

        btnSubmit.disabled = false;
        btnCancel.disabled = false;
    }
};

// LOGIKA GENERATOR WARNA KONSISTEN BERDASARKAN STRING ID INISIAL
export function getColorForInitial(initial) {
    if (!initial || initial === '--') return { bg: '#94a3b8', color: '#ffffff' };
    const cleanInit = String(initial).trim().toUpperCase();
    
    let hash = 0;
    for (let i = 0; i < cleanInit.length; i++) {
        hash = cleanInit.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const palette = [
        { bg: '#ef4444', color: '#ffffff' }, // Merah
        { bg: '#f97316', color: '#ffffff' }, // Oranye
        { bg: '#d97706', color: '#ffffff' }, // Amber
        { bg: '#10b981', color: '#ffffff' }, // Emerald
        { bg: '#06b6d4', color: '#ffffff' }, // Cyan
        { bg: '#3b82f6', color: '#ffffff' }, // Biru
        { bg: '#6366f1', color: '#ffffff' }, // Nila
        { bg: '#8b5cf6', color: '#ffffff' }, // Ungu
        { bg: '#ec4899', color: '#ffffff' }, // Merah Muda
        { bg: '#0f766e', color: '#ffffff' }, // Teal
        { bg: '#b45309', color: '#ffffff' }, // Cokelat Oranye
        { bg: '#4338ca', color: '#ffffff' }  // Biru Tua
    ];
    
    const index = Math.abs(hash) % palette.length;
    return palette[index];
}

// FUNGSI MEMANGGIL & MENAMPILKAN DAFTAR USER
export function renderUserManagementTable() {
    const tbody = document.getElementById('userManagementTableBody');
    if (!tbody) return;

    const usersRef = ref(db, 'users');
    onValue(usersRef, (snapshot) => {
        tbody.innerHTML = '';
        const data = snapshot.val();
        localUsersMap = data || {}; // SIMPAN KE MAP LOKAL UNTUK DITAMPILKAN & DIEDIT

        if (!data) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #7f8c8d; padding: 15px;">Belum ada user terdaftar.</td></tr>`;
            return;
        }

        Object.keys(data).forEach((uid) => {
            const u = data[uid];
            const tr = document.createElement('tr');

            // ID Inisial & Warna Badge
            const uInit = u.id_inisial ? u.id_inisial.toUpperCase() : '--';
            const col = getColorForInitial(uInit);
            const badgeHtml = `<span class="id-initial-badge" style="background-color: ${col.bg}; color: ${col.color};">${uInit}</span>`;

            // Hak Akses Badge
            const roleBadge = u.role === 'Admin' 
                ? `<span class="user-profile-role" style="background: rgba(225,29,72,0.15); color: #f43f5e; border-color: rgba(225,29,72,0.2);">Admin</span>` 
                : `<span class="user-profile-role">Operator</span>`;

            tr.innerHTML = `
                <td style="text-align: center;">${badgeHtml}</td>
                <td>${u.email || '--'}</td>
                <td><strong>${u.nama || '--'}</strong></td>
                <td>${roleBadge}</td>
                <td style="text-align: center;">
                    <button class="btn-action" style="padding: 4px 8px; font-size: 11px; background: #3b82f6;" onclick="window.loadUserToEditForm('${uid}')">✏️ Edit</button>
                    <button class="btn-delete-selected" style="padding: 4px 8px; font-size: 11px;" onclick="window.deleteUserRecord('${uid}', '${u.email}')">🗑️ Hapus</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }, (error) => {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 15px;">Gagal memuat: ${error.message}</td></tr>`;
    });
}

// TOGGLE ROLE ADMIN
window.handleNewRoleChange = function() {
    const roleEl = document.getElementById('newUserRole');
    if (!roleEl) return;
    const role = roleEl.value;
    const chkAdmin = document.getElementById('chkNewAdmin');
    if (!chkAdmin) return;
    
    if (role === 'Admin') {
        chkAdmin.checked = true;
        chkAdmin.disabled = true;
    } else {
        chkAdmin.checked = true;
        chkAdmin.disabled = false;
    }
};

function triggerAdminFormLoading(callback) {
    const formBox = document.getElementById('adminFormBox');
    if (formBox) formBox.classList.add('admin-box-loading');

    setTimeout(() => {
        if (callback) callback();
        if (formBox) formBox.classList.remove('admin-box-loading');
    }, 350);
}

// MEMBUKA FORM TAMBAH USER BARU
// MEMBUKA / MENUTUP (TOGGLE) FORM TAMBAH USER BARU
window.openAddUserForm = function() {
    const formBox = document.getElementById('adminFormBox');
    if (!formBox) return;

    // Cek apakah form sedang terbuka (display: block atau flex)
    const isFormVisible = formBox.style.display !== 'none' && formBox.style.display !== '';

    if (isFormVisible) {
        // Jika form sedang terbuka, sembunyikan (tutup)
        window.resetAdminForm(); // Sekaligus reset form ke kondisi awal
    } else {
        // Jika form sedang tertutup, buka dan reset ke mode tambah user
        window.resetAdminForm();
        formBox.style.display = 'block';
        formBox.scrollIntoView({ behavior: 'smooth' });
    }
};

// LOAD DATA USER KE FORM UNTUK DIEDIT
window.loadUserToEditForm = function(uid) {
    const u = localUsersMap[uid];
    if (!u) return alert("Data user tidak ditemukan!");

    const formBox = document.getElementById('adminFormBox');
    if (formBox) formBox.style.display = 'block';

    triggerAdminFormLoading(() => {
        document.getElementById('editUserUidTarget').value = uid;
        document.getElementById('newUserName').value = u.nama || u.displayName || '';
        document.getElementById('newUserEmail').value = u.email || '';
        document.getElementById('newUserEmail').disabled = true;
        document.getElementById('newUserIdInisial').value = (u.id_inisial || '').toUpperCase();
        document.getElementById('newUserPassword').value = '';
        document.getElementById('newUserRole').value = u.role || 'Operator';

        // MAPPING MULTI-MENU (KP, PI, PGA, DASHBOARD) & PERIZINAN HAPUS
        if (document.getElementById('chkNewMenuKP')) document.getElementById('chkNewMenuKP').checked = u.menus?.kp ?? true;
        if (document.getElementById('chkNewMenuPI')) document.getElementById('chkNewMenuPI').checked = u.menus?.pi ?? true;
        if (document.getElementById('chkNewMenuPGA')) document.getElementById('chkNewMenuPGA').checked = u.menus?.pga ?? true;
        if (document.getElementById('chkNewDashboard')) document.getElementById('chkNewDashboard').checked = u.menus?.dashboard ?? true;
        if (document.getElementById('chkAllowDeleteSelected')) document.getElementById('chkAllowDeleteSelected').checked = Boolean(u.allow_delete_selected);
        
        window.handleNewRoleChange();

        document.getElementById('adminFormTitle').innerText = `✏️ Edit Hak Akses & Role User: ${u.email}`;
        const btnSubmit = document.getElementById('btnAdminSubmit');
        btnSubmit.innerText = '💾 Simpan Perubahan User';
        btnSubmit.style.background = '#f39c12';
        document.getElementById('btnAdminCancelEdit').style.display = 'inline-block';
        
        formBox.scrollIntoView({ behavior: 'smooth' });
    });
};

window.confirmCancelEditAdmin = function() {
    if (confirm("Batalkan perubahan dan kembali ke form pendaftaran user baru?")) {
        triggerAdminFormLoading(() => window.resetAdminForm());
    }
};

// RESET FORM ADMIN
window.resetAdminForm = function() {
    document.getElementById('editUserUidTarget').value = '';
    const form = document.getElementById('adminRegisterForm');
    if (form) form.reset();

    document.getElementById('newUserEmail').disabled = false;
    document.getElementById('adminFormTitle').innerText = '➕ Tambah User Pengguna Baru & Atur Hak Akses';
    
    const btnSubmit = document.getElementById('btnAdminSubmit');
    if (btnSubmit) {
        btnSubmit.innerText = 'Daftarkan User Baru';
        btnSubmit.style.background = '#2ecc71';
        btnSubmit.disabled = false;
    }
    
    if (document.getElementById('btnAdminCancelEdit')) {
        document.getElementById('btnAdminCancelEdit').style.display = 'none';
    }

    const formBox = document.getElementById('adminFormBox');
    if (formBox) formBox.style.display = 'none';

    window.handleNewRoleChange();
};

// HAPUS USER DARI REALTIME DATABASE
window.deleteUserRecord = async function(uid, email) {
    if (!confirm(`Hapus data user ${email} dari database?`)) return;
    try {
        await remove(ref(db, `users/${uid}`));
        alert(`User ${email} berhasil dihapus!`);
    } catch (e) {
        alert("Gagal menghapus user: " + e.message);
    }
};

// SIMPAN / DAFTARKAN USER DENGAN PERIZINAN HAK AKSES
export function setupAdminRegisterForm() {
    const form = document.getElementById('adminRegisterForm');
    if (!form) return;

    window.handleNewRoleChange();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const targetUid = document.getElementById('editUserUidTarget').value;
        const nama = document.getElementById('newUserName').value.trim();
        const email = document.getElementById('newUserEmail').value.trim();
        const idInisial = document.getElementById('newUserIdInisial').value.trim().toUpperCase();
        const password = document.getElementById('newUserPassword').value.trim();
        const role = document.getElementById('newUserRole').value;

        if (idInisial.length < 1 || idInisial.length > 3 || !/^[A-Z]+$/.test(idInisial)) {
            alert("⚠️ ID Inisial wajib 1-3 huruf kapital!");
            return;
        }

        // BACA NILAI SAKELAR MENU DENGAN PENJAGAAN (DEFAULT SAFE)
        const accessKP = document.getElementById('chkNewMenuKP') ? document.getElementById('chkNewMenuKP').checked : true;
        const accessPI = document.getElementById('chkNewMenuPI') ? document.getElementById('chkNewMenuPI').checked : true;
        const accessPGA = document.getElementById('chkNewMenuPGA') ? document.getElementById('chkNewMenuPGA').checked : true;
        const accessDash = document.getElementById('chkNewDashboard') ? document.getElementById('chkNewDashboard').checked : true;
        const accessAdmin = document.getElementById('chkNewAdmin') ? document.getElementById('chkNewAdmin').checked : true;
        const allowDelete = document.getElementById('chkAllowDeleteSelected') ? document.getElementById('chkAllowDeleteSelected').checked : false;

        const isEdit = Boolean(targetUid);
        const actionText = isEdit ? "menyimpan perubahan data user ini" : `mendaftarkan user baru (${email})`;

        if (!confirm(`Apakah Anda yakin ingin ${actionText}?`)) return;

        const btnSubmit = document.getElementById('btnAdminSubmit');
        const originalText = btnSubmit.innerText;
        btnSubmit.disabled = true;

        try {
            // STRUKTUR PERIZINAN USER LENGKAP
            const userDataPayload = {
                nama: nama,
                id_inisial: idInisial,
                role: role,
                allow_delete_selected: allowDelete,
                menus: {
                    kp: accessKP,
                    pi: accessPI,
                    pga: accessPGA,
                    dashboard: accessDash,
                    admin: accessAdmin
                }
            };

            if (isEdit) {
                await update(ref(db, `users/${targetUid}`), userDataPayload);
                alert(`✅ Perubahan data pengguna ${email} berhasil disimpan!`);
            } else {
                if (!password) {
                    alert("Harap masukkan password!");
                    btnSubmit.disabled = false;
                    return;
                }
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                userDataPayload.email = email;
                userDataPayload.created_at = new Date().toISOString();
                
                await set(ref(db, `users/${userCredential.user.uid}`), userDataPayload);
                alert(`✅ User baru (${email}) berhasil terdaftar!`);
            }

            window.resetAdminForm();
        } catch (err) {
            alert("⚠️ Gagal Memproses: " + err.message);
            btnSubmit.innerText = originalText;
            btnSubmit.disabled = false;
        }
    });
}

// Buat fungsi window agar bisa dipanggil langsung dari tombol HTML
window.clearAllDataKP = async function() {
    const konfirmasi = confirm("⚠️ APAKAH ANDA YAKIN?\n\nSemua data Usulan KP di database akan DIHAPUS PERMANEN dan tidak dapat dikembalikan.");
    
    if (!konfirmasi) return;

    try {
        // Ambil referensi ke node 'usulan_kp'
        const kpRef = ref(db, 'usulan_kp'); 
        
        // Hapus seluruh child pada node tersebut
        await remove(kpRef);
        
        alert("✅ Berhasil menghapus semua data Usulan KP!");
        
        // Refresh tampilan aplikasi jika fungsi kustom Anda tersedia
        if (typeof refreshAllDisplays === 'function') {
            refreshAllDisplays();
        }
    } catch (error) {
        console.error("Gagal menghapus data KP:", error);
        alert("❌ Gagal menghapus data: " + error.message);
    }
};