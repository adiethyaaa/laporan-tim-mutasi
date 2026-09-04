import { db, ref, remove, onValue } from "../../services/firebase.js";
import { state } from "../../services/store.js";
import { MODULE_CONFIG } from "../../config/constants.js";
import { 
    normalizeValue, 
    formatTanggal, 
    formatDateTime, 
    cleanInstansiName, 
    formatJenisKP, 
    calculatePeriodeKP 
} from "../../utils/formatters.js";
import { isGolonganIVc, isEligibleForApp, checkIsKPO } from "../../utils/eligibility.js";
import { getColorForInitial } from "../../../admin.js";
import { renderTablePI, sortDataListPI, populateDropdownFiltersPI } from "../pi/piController.js";

export function loadDatabaseData() {
    if (!MODULE_CONFIG[state.currentModule]) return; 
    state.isFirstDbLoad = true;
    
    if (state.currentModule === 'PI') renderTablePI([]); 
    else renderAllTableRows([]);
    
    if (state.dbUnsubscribe) state.dbUnsubscribe();
    
    state.dbUnsubscribe = onValue(ref(db, MODULE_CONFIG[state.currentModule].node), (snapshot) => {
        try {
            state.dbFetchedMap = snapshot.val() || {}; 
            state.isFirstDbLoad = false;
            
            if (state.currentModule === 'PI') {
                populateDropdownFiltersPI(); 
            } else {
                populateDropdownFilters();
            }
            refreshAllDisplays();
        } catch (err) {
            console.error(err); 
            state.isFirstDbLoad = false; 
            const errHtml = `<tr><td colspan="16" style="text-align: center; color: #e74c3c;">⚠️ Gagal Memproses Data</td></tr>`;
            if (state.currentModule === 'PI') document.getElementById('tableBodyPI').innerHTML = errHtml; 
            else document.getElementById('tableBody').innerHTML = errHtml;
        }
    }, (error) => {
        state.isFirstDbLoad = false; 
        const errHtml = `<tr><td colspan="16" style="text-align: center; color: #e74c3c;">⚠️ Gagal Menarik Data Firebase</td></tr>`;
        if (state.currentModule === 'PI') document.getElementById('tableBodyPI').innerHTML = errHtml; 
        else document.getElementById('tableBody').innerHTML = errHtml;
    });
}

export function populateDropdownFilters() {
    const instansiSet = new Set(), periodeSet = new Set();
    Object.values(state.dbFetchedMap || {}).forEach(item => {
        if (!isEligibleForApp(item)) return;
        
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

export function refreshAllDisplays() {
    if (state.currentModule === 'PI') {
        state.combinedDataList = Object.keys(state.dbFetchedMap || {}).map(key => ({ dbKey: key, ...state.dbFetchedMap[key] }));
        
        const sAsal = document.getElementById('filterInstansiAsalPI')?.value || '';
        const sTujuan = document.getElementById('filterInstansiTujuanPI')?.value || '';
        const sWilker = document.getElementById('filterWilkerPI')?.value || '';
        const sStatus = document.getElementById('filterStatusPI')?.value || '';
        
        let filtered = state.combinedDataList.filter(item => { 
            return (!sAsal || item.instansi_asal === sAsal) && 
                   (!sTujuan || item.instansi_tujuan === sTujuan) && 
                   (!sWilker || item.wilker_prov === sWilker) && 
                   (!sStatus || item.status === sStatus); 
        });
        
        sortDataListPI(filtered); 
        renderTablePI(filtered);
    } else {
        state.combinedDataList = Object.keys(state.dbFetchedMap || {})
            .map(key => ({ 
                dbKey: key, 
                periode_kp: state.dbFetchedMap[key].periode_kp || calculatePeriodeKP(state.dbFetchedMap[key].tgl_pengiriman_kelayanan), 
                ...state.dbFetchedMap[key] 
            }))
            .filter(item => {
                const golBaru = item.gol_tmt_baru || item.golongan_ruang || '';
                const golLama = item.gol_tmt_lama || '';
                return !isGolonganIVc(golBaru) && !isGolonganIVc(golLama);
            });
        
        const sInst = document.getElementById('filterInstansi')?.value;
        const sPer = document.getElementById('filterPeriodeKP')?.value;
        const sKat = document.getElementById('filterKategori')?.value;
        const sJen = document.getElementById('filterJenisKP')?.value;
        
        let filtered = state.combinedDataList.filter(item => {
            if (!isEligibleForApp(item)) return false;
            return (!sInst || item.instansi_induk === sInst) && 
                   (!sPer || item.periode_kp === sPer) && 
                   (!sKat || item.kategori_status === sKat) && 
                   (!sJen || (formatJenisKP(item.jenis_kp)) === sJen);
        });
            
        if (document.getElementById('displayedCount')) {
            document.getElementById('displayedCount').innerText = filtered.length;
        }
        if (document.getElementById('totalDbCount')) {
            const totalEligible = state.combinedDataList.filter(i => isEligibleForApp(i)).length;
            document.getElementById('totalDbCount').innerText = totalEligible;
        }
        
        sortDataList(filtered, state.currentSortColumn, state.isAscending);
        if (typeof window.updateDashboardMetrics === 'function') {
            window.updateDashboardMetrics(); 
        }
    }
}

export function renderAllTableRows(dataList) {
    const tbody = document.getElementById('tableBody'); 
    if (!tbody) return; 
    tbody.innerHTML = '';
    
    if (state.isFirstDbLoad) { 
        tbody.innerHTML = `<tr><td colspan="16"><div class="table-loading-overlay"><div class="table-spinner"></div>Memuat data...</div></td></tr>`; 
        return; 
    }

    const validDataList = (dataList || []).filter(rec => {
        const golBaru = rec.gol_tmt_baru || rec.golongan_ruang || '';
        const golLama = rec.gol_tmt_lama || '';
        return !isGolonganIVc(golBaru) && !isGolonganIVc(golLama);
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
        
        const isKpo = checkIsKPO(rec);
        const kpoBadge = isKpo ? `<span style="background-color: #8b5cf6; color: white; padding: 2px 6px; border-radius: 4px; font-size: 7px; font-weight: bold; margin-left: 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.15); vertical-align: middle;">KPO</span>` : '';
        
        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="row-checkbox" data-key="${rec.dbKey}" ${state.selectedDbKeys.has(rec.dbKey) ? 'checked' : ''}></td>
            <td style="text-align: center;"><span class="id-initial-badge" style="background-color: ${c.bg}; color: ${c.color};" title="Waktu Simpan DB: ${formatDateTime(rec.uploaded_at)}">${uInit}</span></td>
            <td>${cleanInstansiName(rec.instansi_induk)}</td>
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
            <td>${formatJenisKP(rec.jenis_kp)}</td>
            <td style="text-align: center;"><button class="btn-preview" onclick="showPreviewModal('${rec.dbKey}')"><i class="fas fa-eye"></i></button></td>
        `;
        tbody.appendChild(tr);
    }); 
    attachCheckboxListeners();
}

export function sortDataList(dataList, col, asc) {
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

export function sortTable(columnName) { 
    state.currentSortColumn = (state.currentSortColumn === columnName) ? columnName : columnName; 
    state.isAscending = (state.currentSortColumn === columnName) ? !state.isAscending : true; 
    
    document.querySelectorAll('.sort-arrow').forEach(el => el.innerText = '↕'); 
    if (document.getElementById(`sort_${state.currentSortColumn}`)) {
        document.getElementById(`sort_${state.currentSortColumn}`).innerText = state.isAscending ? '▲' : '▼'; 
    }
    refreshAllDisplays(); 
}

export function attachCheckboxListeners() {
    const sAll = document.getElementById('selectAll'), rowCbs = document.querySelectorAll('.row-checkbox');
    if (sAll) {
        sAll.onclick = () => { 
            rowCbs.forEach(cb => { 
                cb.checked = sAll.checked; 
                sAll.checked ? state.selectedDbKeys.add(cb.getAttribute('data-key')) : state.selectedDbKeys.delete(cb.getAttribute('data-key')); 
            }); 
            updateDeleteBtnUI(); 
        };
    }
    rowCbs.forEach(cb => {
        cb.onchange = function() { 
            this.checked ? state.selectedDbKeys.add(this.getAttribute('data-key')) : state.selectedDbKeys.delete(this.getAttribute('data-key')); 
            if (sAll) sAll.checked = rowCbs.length === state.selectedDbKeys.size; 
            updateDeleteBtnUI(); 
        };
    });
}

export function showPreviewModal(dbKey) {
    const i = state.combinedDataList.find(x => x.dbKey === dbKey); 
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
        if (modalCard) modalCard.style.display = 'block'; 
    }
}

export function closePreviewModal() {
    const modal = document.getElementById('previewModal');
    if (modal) modal.style.display = 'none';
}

export function handleKPOFilterChange() {
    const toggle = document.getElementById('toggleIncludeKPO');
    if (toggle) {
        state.includeKPO = toggle.checked;
        window.includeKPO = toggle.checked;
    }
    if (typeof window.updateDashboardMetrics === 'function') {
        window.updateDashboardMetrics();
    }
}

export function resetMainFilters(e) {
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

    refreshAllDisplays(); 
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

// Window attachments for inline HTML
if (typeof window !== 'undefined') {
    window.loadDatabaseData = loadDatabaseData;
    window.refreshAllDisplays = refreshAllDisplays;
    window.renderAllTableRows = renderAllTableRows;
    window.sortTable = sortTable;
    window.sortDataList = sortDataList;
    window.showPreviewModal = showPreviewModal;
    window.closePreviewModal = closePreviewModal;
    window.handleKPOFilterChange = handleKPOFilterChange;
    window.resetMainFilters = resetMainFilters;
}
