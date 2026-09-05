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

let pgaEditHistoryStack = [];
const MAX_UNDO_STATES = 5;
let currentSortColumnPGA = 'tgl_usul';
let isAscendingPGA = false;

export function renderTablePGA(dataList) {
    const tbody = document.getElementById('tableBodyPGA'); 
    if (!tbody) return; 
    tbody.innerHTML = '';
    
    if (state.isFirstDbLoad) { 
        tbody.innerHTML = `<tr><td colspan="10"><div class="table-loading-overlay"><div class="table-spinner"></div>Memuat data PGA...</div></td></tr>`; 
        return; 
    }
    
    if (!dataList || dataList.length === 0) { 
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #7f8c8d; padding: 20px;">Belum ada data PGA yang sesuai filter.</td></tr>`; 
        return; 
    }

    const totalData = dataList.length;
    
    dataList.forEach((rec, idx) => {
        const tr = document.createElement('tr');
        if (rec.status === 'TMS') tr.classList.add('row-tms'); 
        else if (rec.status === 'BTS') tr.classList.add('row-bts');
        
        const uInit = (rec.validator && rec.validator !== '--') 
            ? String(rec.validator).toUpperCase() 
            : ((rec.uploader_initial && rec.uploader_initial !== '--') ? String(rec.uploader_initial).toUpperCase() : 'OP');
        const c = (typeof getColorForInitial === 'function') ? getColorForInitial(uInit) : { bg: '#4338ca', color: '#fff' };
        
        const noDescending = totalData - idx;

        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="row-checkbox-pga" data-key="${rec.dbKey}"></td>
            <td style="text-align: center; font-weight: bold;">${noDescending}</td>
            <td style="text-align: center;"><span class="id-initial-badge" style="background-color: ${c.bg}; color: ${c.color};" title="Validator / Uploader">${uInit}</span></td>
            <td><strong>${rec.nama || '-'}</strong></td>
            <td style="font-family: helvetica; font-size: 12px;">${rec.nip || '-'}</td>
            <td>${rec.instansi || '-'}</td>
            <td style="text-align: center; font-size: 11px;">${rec.tgl_usul || '-'}</td>
            <td style="text-align: center;"><strong>${rec.status || '-'}</strong></td>
            <td>${rec.keterangan || '-'}</td>
            <td style="text-align: center;">
                <button class="btn-edit-animated" onclick="editRecordPGA('${rec.dbKey}')" title="Edit Data PGA">
                    <i class="fas fa-pen-to-square"></i> <span>Edit</span>
                </button>
            </td>
        `; 
        tbody.appendChild(tr);
    }); 

    attachCheckboxListenersPGA();
}

export function sortTablePGA(columnName) { 
    if (currentSortColumnPGA === columnName) { 
        isAscendingPGA = !isAscendingPGA; 
    } else { 
        currentSortColumnPGA = columnName; 
        isAscendingPGA = (columnName === 'nama' || columnName === 'instansi'); 
    } 
    
    ['validator', 'nama', 'nip', 'instansi', 'tgl_usul', 'status'].forEach(col => { 
        const el = document.getElementById(`sort_pga_${col}`); 
        if (el) el.innerText = '↕'; 
    }); 
    
    const activeArrow = document.getElementById(`sort_pga_${currentSortColumnPGA}`); 
    if (activeArrow) activeArrow.innerText = isAscendingPGA ? '▲' : '▼'; 
    
    if (typeof window.refreshAllDisplays === 'function') {
        window.refreshAllDisplays(); 
    }
}

export function sortDataListPGA(dataList) { 
    dataList.sort((a, b) => { 
        let valA = a[currentSortColumnPGA] || '--'; 
        let valB = b[currentSortColumnPGA] || '--'; 
        
        if (currentSortColumnPGA === 'tgl_usul') { 
            valA = (valA === '--') ? new Date(0) : new Date(valA); 
            valB = (valB === '--') ? new Date(0) : new Date(valB); 
        } 
        
        if (valA < valB) return isAscendingPGA ? -1 : 1; 
        if (valA > valB) return isAscendingPGA ? 1 : -1; 
        return 0; 
    }); 
}

export function populateDropdownFiltersPGA() {
    const filterInstansiEl = document.getElementById('filterInstansiPGA');
    if (!filterInstansiEl) return;

    const currentVal = filterInstansiEl.value;
    const instansiSet = new Set();
    const records = Object.values(state.dbFetchedMap || {});

    records.forEach(rec => {
        if (rec.instansi && String(rec.instansi).trim() !== '' && rec.instansi !== '--') {
            instansiSet.add(rec.instansi);
        }
    });

    const sortedInstansi = Array.from(instansiSet).sort((a, b) => a.localeCompare(b));
    let optionsHtml = '<option value="">-- Semua Instansi --</option>';
    sortedInstansi.forEach(nama => {
        optionsHtml += `<option value="${nama}">${nama}</option>`;
    });

    filterInstansiEl.innerHTML = optionsHtml;
    filterInstansiEl.value = currentVal;
}

export function filterTablePGA() {
    const filterInstansiEl = document.getElementById('filterInstansiPGA');
    const filterStatusEl = document.getElementById('filterStatusPGA');

    const filterInstansi = (filterInstansiEl?.value || "").trim().toLowerCase();
    const filterStatus = (filterStatusEl?.value || "").trim().toLowerCase();

    [filterInstansiEl, filterStatusEl].forEach(el => {
        if (!el) return;
        if (el.value !== "") {
            el.classList.add('filter-active');
        } else {
            el.classList.remove('filter-active');
        }
    });

    const dataToFilter = Object.keys(state.dbFetchedMap || {}).map(k => ({ dbKey: k, ...state.dbFetchedMap[k] }));

    const filteredData = dataToFilter.filter(item => {
        const instansi = (item.instansi || "").trim().toLowerCase();
        const itemStatus = (item.status || "").trim().toLowerCase();

        const matchInstansi = !filterInstansi || instansi === filterInstansi;
        
        let matchStatus = true;
        if (filterStatus) {
            if (filterStatus === 'ms' || filterStatus === 'acc') {
                matchStatus = (itemStatus === 'ms' || itemStatus === 'acc');
            } else {
                matchStatus = (itemStatus === filterStatus);
            }
        }

        return matchInstansi && matchStatus;
    });

    state.combinedDataList = filteredData;
    sortDataListPGA(filteredData);
    renderTablePGA(filteredData);
}

export function resetFilterPGA() {
    const filterInstansiEl = document.getElementById('filterInstansiPGA');
    const filterStatusEl = document.getElementById('filterStatusPGA');

    if (filterInstansiEl) filterInstansiEl.value = "";
    if (filterStatusEl) filterStatusEl.value = "";

    filterTablePGA();
}

export function pushPgaActionState(actionType, recordsArray) {
    if (pgaEditHistoryStack.length >= MAX_UNDO_STATES) {
        pgaEditHistoryStack.shift();
    }
    pgaEditHistoryStack.push({
        type: actionType,
        records: recordsArray,
        timestamp: Date.now()
    });
    updatePgaUndoButtonUI();
}

export function updatePgaUndoButtonUI() {
    const btnUndo = document.getElementById('btnUndoEditPGA');
    if (!btnUndo) return;
    if (pgaEditHistoryStack.length > 0) {
        btnUndo.disabled = false;
        btnUndo.style.opacity = '1';
        btnUndo.style.cursor = 'pointer';
        btnUndo.title = `Undo aksi terakhir (${pgaEditHistoryStack.length} riwayat)`;
    } else {
        btnUndo.disabled = true;
        btnUndo.style.opacity = '0.5';
        btnUndo.style.cursor = 'not-allowed';
        btnUndo.title = 'Tidak ada aksi yang dapat di-undo';
    }
}

export async function undoLastPGAChange() {
    if (pgaEditHistoryStack.length === 0) return;
    const lastAction = pgaEditHistoryStack[pgaEditHistoryStack.length - 1];
    const btnUndo = document.getElementById('btnUndoEditPGA');
    if (btnUndo) btnUndo.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memulihkan...';

    const node = MODULE_CONFIG['PGA']?.node || 'usulan_pga';

    try {
        if (lastAction.type === 'DELETE') {
            const updates = {};
            lastAction.records.forEach(item => {
                updates[`${node}/${item.dbKey}`] = item.data;
            });
            await update(ref(db), updates);
            alert(`✅ Berhasil mengembalikan ${lastAction.records.length} data PGA yang sebelumnya dihapus!`);
        } else if (lastAction.type === 'EDIT') {
            const itemToRestore = lastAction.records[0];
            if (itemToRestore) {
                await set(ref(db, `${node}/${itemToRestore.dbKey}`), itemToRestore.data);
                alert("✅ Berhasil mengembalikan (undo) perubahan data edit PGA!");
            }
        }
        pgaEditHistoryStack.pop();
    } catch (err) {
        alert("❌ Gagal melakukan undo PGA: " + err.message);
    } finally {
        if (btnUndo) btnUndo.innerHTML = '<i class="fas fa-rotate-left"></i> Undo';
        updatePgaUndoButtonUI();
    }
}

export function openModalFormPGA(isEdit = false, dbKey = '') {
    const modal = document.getElementById('modalFormPGA');
    const title = document.getElementById('modalTitleTextPGA');
    if (!modal) return;

    renderInstansiDatalistPGA();

    if (!isEdit) {
        document.getElementById('formEditPGA')?.reset();
        const editKey = document.getElementById('editKeyPGA');
        if (editKey) editKey.value = '';
        const editValidator = document.getElementById('editValidatorPGA');
        if (editValidator && state.currentUserInitial && state.currentUserInitial !== '--') {
            editValidator.value = state.currentUserInitial;
        }
        if (title) title.innerHTML = '<i class="fas fa-plus"></i> Tambah Data PGA Baru';
    } else {
        const item = state.dbFetchedMap ? state.dbFetchedMap[dbKey] : null;
        if (!item) {
            alert("❌ Data PGA tidak ditemukan.");
            return;
        }

        const editKey = document.getElementById('editKeyPGA');
        if (editKey) editKey.value = dbKey;

        const namaEl = document.getElementById('editNamaPGA');
        if (namaEl) namaEl.value = item.nama || '';

        const nipEl = document.getElementById('editNipPGA');
        if (nipEl) nipEl.value = item.nip || '';

        const valEl = document.getElementById('editValidatorPGA');
        if (valEl) valEl.value = item.validator || item.uploader_initial || '';

        const instEl = document.getElementById('editInstansiPGA');
        if (instEl) instEl.value = item.instansi || '';

        const tglEl = document.getElementById('editTglUsulPGA');
        if (tglEl) tglEl.value = item.tgl_usul || '';

        const statusEl = document.getElementById('editStatusPGA');
        let stVal = (item.status || 'INBOX').toUpperCase().trim();
        if (stVal === 'ACC') stVal = 'MS';
        if (statusEl) statusEl.value = stVal;

        const ketEl = document.getElementById('editKeteranganPGA');
        if (ketEl) ketEl.value = item.keterangan || '';

        if (title) title.innerHTML = '<i class="fas fa-pen-to-square"></i> Edit Data PGA';
    }
    
    modal.style.display = 'flex';
}

export function closeModalFormPGA() {
    const modal = document.getElementById('modalFormPGA');
    if (modal) modal.style.display = 'none';
    document.getElementById('formEditPGA')?.reset();
    const editKey = document.getElementById('editKeyPGA');
    if (editKey) editKey.value = '';
}

export function editRecordPGA(dbKey) {
    openModalFormPGA(true, dbKey);
}

export function attachCheckboxListenersPGA() {
    const sAll = document.getElementById('selectAllPGA');
    const rowCbs = document.querySelectorAll('.row-checkbox-pga');
    
    if (sAll) { 
        sAll.onclick = () => { 
            rowCbs.forEach(cb => { 
                cb.checked = sAll.checked; 
                const k = cb.getAttribute('data-key'); 
                if (k) { sAll.checked ? state.selectedDbKeys.add(k) : state.selectedDbKeys.delete(k); } 
            }); 
            updateDeleteBtnUIPGA(); 
        }; 
    }
    rowCbs.forEach(cb => { 
        cb.onchange = function() { 
            const k = this.getAttribute('data-key'); 
            if (k) { this.checked ? state.selectedDbKeys.add(k) : state.selectedDbKeys.delete(k); } 
            if (sAll) sAll.checked = rowCbs.length === state.selectedDbKeys.size; 
            updateDeleteBtnUIPGA(); 
        }; 
    });
}

export function updateDeleteBtnUIPGA() {
    const countEl = document.getElementById('selectedCountPGA');
    if (countEl) countEl.innerText = state.selectedDbKeys.size;
    
    const canDelete = (state.currentUserRole.toLowerCase() === 'admin') || state.currentUserAllowDelete;
    const btnDeletePGA = document.getElementById('btnDeleteSelectedPGA');
    if (btnDeletePGA) {
        btnDeletePGA.style.display = (canDelete && state.currentModule === 'PGA' && state.selectedDbKeys.size > 0) ? 'inline-block' : 'none';
    }
}

export function renderInstansiDatalistPGA() {
    const datalist = document.getElementById('listInstansiSuggestPGA');
    if (datalist && typeof masterInstansiData !== 'undefined') {
        datalist.innerHTML = masterInstansiData.map(item => `<option value="${item.name}"></option>`).join('');
    }
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
        formEditPGA.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const dbKey = document.getElementById('editKeyPGA')?.value.trim() || '';
            const rawInstansi = document.getElementById('editInstansiPGA')?.value || '';
            const instansiClean = standardizeInstansiName(rawInstansi);

            const recordPayload = {
                nama: document.getElementById('editNamaPGA')?.value.trim() || '',
                nip: document.getElementById('editNipPGA')?.value.trim() || '',
                validator: (document.getElementById('editValidatorPGA')?.value || state.currentUserInitial || 'OP').trim().toUpperCase(),
                instansi: instansiClean,
                tgl_usul: document.getElementById('editTglUsulPGA')?.value.trim() || '',
                status: document.getElementById('editStatusPGA')?.value.trim().toUpperCase() || 'INBOX',
                keterangan: document.getElementById('editKeteranganPGA')?.value.trim() || '',
                uploader_initial: (state.currentUserInitial !== '--') ? state.currentUserInitial : 'OP',
                uploaded_at: new Date().toISOString()
            };

            const node = MODULE_CONFIG['PGA']?.node || 'usulan_pga';

            try {
                if (dbKey) {
                    const oldRecord = state.dbFetchedMap ? state.dbFetchedMap[dbKey] : null;
                    if (oldRecord) {
                        pushPgaActionState('EDIT', [{ dbKey: dbKey, data: { ...oldRecord } }]);
                    }
                    await update(ref(db, `${node}/${dbKey}`), recordPayload);
                    alert("✅ Data Usulan PGA berhasil diperbarui!");
                } else {
                    await push(ref(db, node), recordPayload);
                    alert("✅ Data Usulan PGA baru berhasil ditambahkan!");
                }
                closeModalFormPGA();
            } catch (err) {
                alert("❌ Gagal menyimpan data PGA: " + err.message);
            }
        });
    }

    const btnDeleteSelectedPGA = document.getElementById('btnDeleteSelectedPGA');
    if (btnDeleteSelectedPGA) {
        btnDeleteSelectedPGA.addEventListener('click', async () => {
            if (state.selectedDbKeys.size === 0) {
                alert("⚠️ Silakan centang minimal satu data PGA yang ingin dihapus.");
                return;
            }

            if (!confirm(`🗑️ Apakah Anda yakin ingin menghapus ${state.selectedDbKeys.size} data PGA yang dipilih?`)) return; 

            btnDeleteSelectedPGA.disabled = true;
            btnDeleteSelectedPGA.innerText = 'Menghapus...';

            const node = MODULE_CONFIG['PGA']?.node || 'usulan_pga';

            try { 
                const deletedItemsSnapshot = [];
                state.selectedDbKeys.forEach(key => {
                    if (state.dbFetchedMap[key]) {
                        deletedItemsSnapshot.push({
                            dbKey: key,
                            data: { ...state.dbFetchedMap[key] }
                        });
                    }
                });

                if (deletedItemsSnapshot.length > 0) {
                    pushPgaActionState('DELETE', deletedItemsSnapshot);
                }

                await Promise.all(Array.from(state.selectedDbKeys).map(k => remove(ref(db, `${node}/${k}`)))); 
                
                state.selectedDbKeys.clear(); 
                if (document.getElementById('selectAllPGA')) document.getElementById('selectAllPGA').checked = false;
                
                updateDeleteBtnUIPGA(); 
                alert("✅ Data Usulan PGA terpilih berhasil dihapus!");
            } catch (e) { 
                alert(`❌ Gagal menghapus data PGA: ${e.message}`); 
            } finally { 
                btnDeleteSelectedPGA.disabled = false; 
                btnDeleteSelectedPGA.innerHTML = '🗑️ Hapus Terpilih PGA (<span id="selectedCountPGA">0</span>)';
            }
        });
    }
}

// Pasang ke window agar inline HTML onclick dapat mengakses langsung
if (typeof window !== 'undefined') {
    window.renderTablePGA = renderTablePGA;
    window.sortTablePGA = sortTablePGA;
    window.sortDataListPGA = sortDataListPGA;
    window.populateDropdownFiltersPGA = populateDropdownFiltersPGA;
    window.filterTablePGA = filterTablePGA;
    window.resetFilterPGA = resetFilterPGA;
    window.undoLastPGAChange = undoLastPGAChange;
    window.openModalFormPGA = openModalFormPGA;
    window.closeModalFormPGA = closeModalFormPGA;
    window.editRecordPGA = editRecordPGA;
    window.attachCheckboxListenersPGA = attachCheckboxListenersPGA;
    window.updateDeleteBtnUIPGA = updateDeleteBtnUIPGA;
}

