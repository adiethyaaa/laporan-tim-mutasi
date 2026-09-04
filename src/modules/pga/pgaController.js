export function openModalFormPGA(isEdit = false) {
    const modal = document.getElementById('modalFormPGA');
    const title = document.getElementById('modalTitleTextPGA');
    
    if (!modal) return;

    if (!isEdit) {
        document.getElementById('formEditPGA')?.reset();
        const editKey = document.getElementById('editKeyPGA');
        if (editKey) editKey.value = '';
        if (title) title.innerHTML = '<i class="fas fa-plus"></i> Tambah Data PGA';
    } else {
        if (title) title.innerHTML = '<i class="fas fa-pen-to-square"></i> Edit Data PGA';
    }
    
    modal.style.display = 'flex';
}

export function closeModalFormPGA() {
    const modal = document.getElementById('modalFormPGA');
    if (modal) modal.style.display = 'none';
    document.getElementById('formEditPGA')?.reset();
}

export function setupPGAEventListeners() {
    const modal = document.getElementById('modalFormPGA');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModalFormPGA();
            }
        });
    }

    const formEditPGA = document.getElementById('formEditPGA');
    if (formEditPGA) {
        formEditPGA.addEventListener('submit', function(e) {
            e.preventDefault();
            // Placeholder: siap dihubungkan ke Firebase / Supabase saat Mas Adit melanjutkan fitur PGA
            console.log("Submit PGA form triggered");
        });
    }
}

// Pasang ke window agar onclick HTML dapat mengakses langsung
if (typeof window !== 'undefined') {
    window.openModalFormPGA = openModalFormPGA;
    window.closeModalFormPGA = closeModalFormPGA;
}
