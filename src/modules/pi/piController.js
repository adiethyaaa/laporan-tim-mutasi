import { db, ref, push, update, remove, set } from "../../services/firebase.js";
import { state } from "../../services/store.js";
import { MODULE_CONFIG } from "../../config/constants.js";
import { 
    normalizeValue, 
    formatTanggal, 
    formatDateTime, 
    standardizeInstansiName 
} from "../../utils/formatters.js";
import { getColorForInitial } from "../../../admin.js";
import { masterInstansiData } from "../master/masterInstansi.js";

let piEditHistoryStack = [];
const MAX_UNDO_STATES = 5;
let currentSortColumnPI = 'tgl_validasi';
let isAscendingPI = false;

export function renderTablePI(dataList) {
    const tbody = document.getElementById('tableBodyPI'); 
    if (!tbody) return; 
    tbody.innerHTML = '';
    
    if (state.isFirstDbLoad) { 
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
        
        const instAsalBaku = standardizeInstansiName(rec.instansi_asal);
        const instTujuanBaku = standardizeInstansiName(rec.instansi_tujuan);
        const wilkerAuto = getAutomaticWilker(instAsalBaku, instTujuanBaku);

        let wilkerBadgeClass = 'badge-wilker-vertikal';
        if (wilkerAuto === 'Papua Barat') {
            wilkerBadgeClass = 'badge-wilker-pb';
        } else if (wilkerAuto === 'Papua Barat Daya') {
            wilkerBadgeClass = 'badge-wilker-pbd';
        }

        const noDescending = totalData - idx;

        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="row-checkbox-pi" data-key="${rec.dbKey}"></td>
            <td style="text-align: center; font-weight: bold;">${noDescending}</td>
            <td style="text-align: center;"><span class="id-initial-badge" style="background-color: ${c.bg}; color: ${c.color};" title="Diunggah: ${formatDateTime(rec.uploaded_at)}">${uInit}</span></td>
            <td style="text-align: center; font-size: 10px;">${rec.tgl_validasi || '-'}</td>
            <td><strong>${rec.nama || '-'}</strong></td>
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

    attachCheckboxListenersPI();
}

export function getAutomaticWilker(instansiAsal, instansiTujuan) {
    const cleanTujuan = (instansiTujuan || "").trim().toUpperCase();
    if (!cleanTujuan) return "Instansi Vertikal";

    const matchTujuan = masterInstansiData.find(item => item.name.toUpperCase() === cleanTujuan);
    if (matchTujuan) return matchTujuan.wilker;

    const pbKeywords = ["MANOKWARI", "BINTUNI", "WONDAMA", "KAIMANA", "FAK-FAK", "PAPUA BARAT"];
    const pbdKeywords = ["SORONG", "RAJA AMPAT", "TAMBRAUW", "MAYBRAT", "PAPUA BARAT DAYA"];

    if (cleanTujuan.includes("PAPUA BARAT DAYA") || pbdKeywords.some(kw => cleanTujuan.includes(kw))) {
        return "Papua Barat Daya";
    }

    if (pbKeywords.some(kw => cleanTujuan.includes(kw))) {
        return "Papua Barat";
    }

    return "Instansi Vertikal";
}

export function sortTablePI(columnName) { 
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
    if (typeof window.refreshAllDisplays === 'function') {
        window.refreshAllDisplays(); 
    }
}

export function sortDataListPI(dataList) { 
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

export function populateDropdownFiltersPI() {
    const filterAsalEl = document.getElementById('filterInstansiAsalPI');
    const filterTujuanEl = document.getElementById('filterInstansiTujuanPI');

    if (!filterAsalEl || !filterTujuanEl) return;

    const currentAsal = filterAsalEl.value;
    const currentTujuan = filterTujuanEl.value;

    const instansiAsalSet = new Set();
    const instansiTujuanSet = new Set();

    const records = Object.values(state.dbFetchedMap || {});

    records.forEach(rec => {
        if (rec.instansi_asal && String(rec.instansi_asal).trim() !== '') {
            const asalBaku = standardizeInstansiName(rec.instansi_asal);
            if (asalBaku && asalBaku !== '--') instansiAsalSet.add(asalBaku);
        }
        if (rec.instansi_tujuan && String(rec.instansi_tujuan).trim() !== '') {
            const tujuanBaku = standardizeInstansiName(rec.instansi_tujuan);
            if (tujuanBaku && tujuanBaku !== '--') instansiTujuanSet.add(tujuanBaku);
        }
    });

    const sortedAsal = Array.from(instansiAsalSet).sort((a, b) => a.localeCompare(b));
    const sortedTujuan = Array.from(instansiTujuanSet).sort((a, b) => a.localeCompare(b));

    let optionsHtmlAsal = '<option value="">-- Semua Instansi Asal --</option>';
    sortedAsal.forEach(nama => {
        optionsHtmlAsal += `<option value="${nama}">${nama}</option>`;
    });

    let optionsHtmlTujuan = '<option value="">-- Semua Instansi Tujuan --</option>';
    sortedTujuan.forEach(nama => {
        optionsHtmlTujuan += `<option value="${nama}">${nama}</option>`;
    });

    filterAsalEl.innerHTML = optionsHtmlAsal;
    filterTujuanEl.innerHTML = optionsHtmlTujuan;

    filterAsalEl.value = currentAsal;
    filterTujuanEl.value = currentTujuan;
}

export function populatePIFilters() {
    populateDropdownFiltersPI();
}

export function renderInstansiDatalist() {
    const datalist = document.getElementById('listInstansiSuggest');
    if (datalist && typeof masterInstansiData !== 'undefined') {
        datalist.innerHTML = masterInstansiData.map(item => `<option value="${item.name}"></option>`).join('');
    }
}

export function filterTablePI() {
    const filterAsalEl = document.getElementById('filterInstansiAsalPI');
    const filterTujuanEl = document.getElementById('filterInstansiTujuanPI');
    const filterWilkerEl = document.getElementById('filterWilkerPI');
    const filterStatusEl = document.getElementById('filterStatusPI');

    const filterAsal = (filterAsalEl?.value || "").trim().toLowerCase();
    const filterTujuan = (filterTujuanEl?.value || "").trim().toLowerCase();
    const filterWilker = (filterWilkerEl?.value || "").trim().toLowerCase();
    const filterStatus = (filterStatusEl?.value || "").trim().toLowerCase();

    [filterAsalEl, filterTujuanEl, filterWilkerEl, filterStatusEl].forEach(el => {
        if (!el) return;
        if (el.value !== "") {
            el.classList.add('filter-active');
        } else {
            el.classList.remove('filter-active');
        }
    });

    const dataToFilter = Object.keys(state.dbFetchedMap || {}).map(k => ({ dbKey: k, ...state.dbFetchedMap[k] }));

    const filteredData = dataToFilter.filter(item => {
        const instAsalBaku = standardizeInstansiName(item.instansi_asal || "");
        const instTujuanBaku = standardizeInstansiName(item.instansi_tujuan || "");
        const wilkerAuto = getAutomaticWilker(instAsalBaku, instTujuanBaku) || item.wilker_prov || "Instansi Vertikal";
        const itemStatus = (item.status || "").trim().toLowerCase();

        const matchAsal = !filterAsal || instAsalBaku.toLowerCase() === filterAsal;
        const matchTujuan = !filterTujuan || instTujuanBaku.toLowerCase() === filterTujuan;
        const matchWilker = !filterWilker || wilkerAuto.toLowerCase() === filterWilker;
        
        let matchStatus = true;
        if (filterStatus) {
            if (filterStatus === 'ms' || filterStatus === 'acc') {
                matchStatus = (itemStatus === 'ms' || itemStatus === 'acc');
            } else {
                matchStatus = (itemStatus === filterStatus);
            }
        }

        return matchAsal && matchTujuan && matchWilker && matchStatus;
    });

    state.combinedDataList = filteredData;
    sortDataListPI(filteredData);
    renderTablePI(filteredData);
}

export function resetFilterPI() {
    const filterAsalEl = document.getElementById('filterInstansiAsalPI');
    const filterTujuanEl = document.getElementById('filterInstansiTujuanPI');
    const filterWilkerEl = document.getElementById('filterWilkerPI');
    const filterStatusEl = document.getElementById('filterStatusPI');

    if (filterAsalEl) filterAsalEl.value = "";
    if (filterTujuanEl) filterTujuanEl.value = "";
    if (filterWilkerEl) filterWilkerEl.value = "";
    if (filterStatusEl) filterStatusEl.value = "";

    filterTablePI();
}

export function pushPiActionState(actionType, recordsArray) {
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

export function updatePiUndoButtonUI() {
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

export async function undoLastPIChange() {
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

    if (!confirm(`↩️ UNDO KONFIRMASI:\nApakah Anda yakin ingin ${actionNameText}?`)) return;

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
                if (currentActiveKey === itemToRestore.dbKey) {
                    editRecordPI(itemToRestore.dbKey);
                }
            }
        }
        piEditHistoryStack.pop();
    } catch (err) {
        alert("❌ Gagal melakukan undo: " + err.message);
    } finally {
        if (btnUndo) btnUndo.innerHTML = '<i class="fas fa-rotate-left"></i> Undo';
        updatePiUndoButtonUI();
    }
}

export function openAddFormPI() {
    closeEditFormPI();
    const titleText = document.getElementById('sideFormTitleTextPI');
    if (titleText) titleText.innerText = 'Tambah Data PI Baru';
    const sideForm = document.getElementById('sideEditFormPI');
    if (sideForm) sideForm.style.display = 'block';
    updatePiUndoButtonUI();
}

export function editRecordPI(dbKey) {
    const item = state.dbFetchedMap ? state.dbFetchedMap[dbKey] : null;
    if (!item) return alert("❌ Data tidak ditemukan.");

    closeEditFormPI();

    let statusValue = (item.status || 'INBOX').toUpperCase().trim();
    if (statusValue === 'ACC') statusValue = 'MS';

    const keyEl = document.getElementById('editKeyPI');
    if (keyEl) keyEl.value = dbKey;

    const namaEl = document.getElementById('editNamaPI');
    if (namaEl) namaEl.value = item.nama || '';

    const nipEl = document.getElementById('editNipPI');
    if (nipEl) nipEl.value = item.nip || '';

    const asalEl = document.getElementById('editInstansiAsalPI');
    if (asalEl) asalEl.value = standardizeInstansiName(item.instansi_asal || '');

    const tujuanEl = document.getElementById('editInstansiTujuanPI');
    if (tujuanEl) tujuanEl.value = standardizeInstansiName(item.instansi_tujuan || '');

    const tglEl = document.getElementById('editTglValidasiPI');
    if (tglEl) tglEl.value = item.tgl_validasi || '';

    const statusEl = document.getElementById('editStatusPI');
    if (statusEl) statusEl.value = statusValue;

    const ketEl = document.getElementById('editKeteranganPI');
    if (ketEl) ketEl.value = item.keterangan || '';

    const titleText = document.getElementById('sideFormTitleTextPI');
    if (titleText) titleText.innerText = 'Edit Data PI';

    const sideForm = document.getElementById('sideEditFormPI');
    if (sideForm) sideForm.style.display = 'block';

    updatePiUndoButtonUI();
    sideForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function closeEditFormPI() {
    const sideForm = document.getElementById('sideEditFormPI');
    if (sideForm) sideForm.style.display = 'none';
    const formEl = document.getElementById('formEditPI');
    if (formEl) formEl.reset();
    const keyEl = document.getElementById('editKeyPI');
    if (keyEl) keyEl.value = '';
}

export function attachCheckboxListenersPI() {
    const sAll = document.getElementById('selectAllPI'), rowCbs = document.querySelectorAll('.row-checkbox-pi');
    if (sAll) { 
        sAll.onclick = () => { 
            rowCbs.forEach(cb => { 
                cb.checked = sAll.checked; 
                const k = cb.getAttribute('data-key'); 
                if (k) { sAll.checked ? state.selectedDbKeys.add(k) : state.selectedDbKeys.delete(k); } 
            }); 
            updateDeleteBtnUI(); 
        }; 
    }
    rowCbs.forEach(cb => { 
        cb.onchange = function() { 
            const k = this.getAttribute('data-key'); 
            if (k) { this.checked ? state.selectedDbKeys.add(k) : state.selectedDbKeys.delete(k); } 
            if (sAll) sAll.checked = rowCbs.length === state.selectedDbKeys.size; 
            updateDeleteBtnUI(); 
        }; 
    });
}

export function updateDeleteBtnUI() {
    if (document.getElementById('selectedCount')) document.getElementById('selectedCount').innerText = state.selectedDbKeys.size;
    if (document.getElementById('selectedCountPI')) document.getElementById('selectedCountPI').innerText = state.selectedDbKeys.size;
    
    const canDelete = (state.currentUserRole.toLowerCase() === 'admin') || state.currentUserAllowDelete;
    
    const btnDeleteKP = document.getElementById('btnDeleteSelected');
    if (btnDeleteKP) btnDeleteKP.style.display = (canDelete && state.currentModule === 'KP' && state.selectedDbKeys.size > 0) ? 'inline-block' : 'none';
    
    const btnDeletePI = document.getElementById('btnDeleteSelectedPI');
    if (btnDeletePI) btnDeletePI.style.display = (canDelete && state.currentModule === 'PI' && state.selectedDbKeys.size > 0) ? 'inline-block' : 'none';
}

// Window attachments for HTML inline onclick
if (typeof window !== 'undefined') {
    window.renderTablePI = renderTablePI;
    window.getAutomaticWilker = getAutomaticWilker;
    window.sortTablePI = sortTablePI;
    window.sortDataListPI = sortDataListPI;
    window.populatePIFilters = populatePIFilters;
    window.renderInstansiDatalist = renderInstansiDatalist;
    window.filterTablePI = filterTablePI;
    window.resetFilterPI = resetFilterPI;
    window.undoLastPIChange = undoLastPIChange;
    window.openAddFormPI = openAddFormPI;
    window.editRecordPI = editRecordPI;
    window.closeEditFormPI = closeEditFormPI;
    window.attachCheckboxListenersPI = attachCheckboxListenersPI;
}
