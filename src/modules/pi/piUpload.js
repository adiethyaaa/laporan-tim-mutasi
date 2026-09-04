import { db, ref, push, update, remove } from "../../services/firebase.js";
import { state } from "../../services/store.js";
import { MODULE_CONFIG } from "../../config/constants.js";
import { 
    normalizeValue, 
    formatTanggal, 
    formatFileSize, 
    standardizeInstansiName 
} from "../../utils/formatters.js";
import { isValidExcelStructurePI } from "../../utils/excelParser.js";
import { 
    getAutomaticWilker, 
    pushPiActionState, 
    updateDeleteBtnUI, 
    closeEditFormPI 
} from "./piController.js";

export function setupDragAndDropPI() {
    const dropZone = document.getElementById('dropZonePI');
    const fileInput = document.getElementById('uploadPI'); 
    if (!dropZone || !fileInput) return;
    
    dropZone.addEventListener('click', () => fileInput.click()); 
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, evt => { evt.preventDefault(); evt.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('dragover'))); 
    ['dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('dragover')));
    
    dropZone.addEventListener('drop', e => handleNewFilesPI(Array.from(e.dataTransfer.files))); 
    fileInput.addEventListener('change', e => { handleNewFilesPI(Array.from(e.target.files)); e.target.value = ''; });
}

export async function handleNewFilesPI(files) {
    if (files.length === 0) return;
    for (let file of files) {
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const buffer = await file.arrayBuffer(); 
            const rows = XLSX.utils.sheet_to_json(XLSX.read(buffer, { type: 'array' }).Sheets[XLSX.read(buffer, { type: 'array' }).SheetNames[0]], { header: 1 });
            if (!isValidExcelStructurePI(rows)) { 
                alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" tidak sesuai struktur PI.`); 
                continue; 
            }
            if (!state.selectedFilesQueuePI.some(f => f.name === file.name && f.size === file.size)) {
                state.selectedFilesQueuePI.push(file);
            }
        } else { 
            alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" bukan Excel.`); 
        }
    }
    renderFileQueueUIPI();
}

export function renderFileQueueUIPI() {
    const queueCard = document.getElementById('fileQueueCardPI');
    const container = document.getElementById('fileListContainerPI'); 
    if (!queueCard || !container) return;
    
    if (state.selectedFilesQueuePI.length === 0) { 
        queueCard.style.display = 'none'; 
        return; 
    }
    
    queueCard.style.display = 'block'; 
    document.getElementById('fileCountTextPI').innerText = state.selectedFilesQueuePI.length; 
    container.innerHTML = '';
    
    state.selectedFilesQueuePI.forEach((file, index) => { 
        const d = document.createElement('div'); 
        d.className = 'file-item'; 
        d.innerHTML = `<div class="file-info"><span>📊</span><span class="file-name">${file.name}</span><span class="file-size">(${formatFileSize(file.size)})</span></div><button class="btn-remove-file" onclick="removeFileFromQueuePI(${index})">❌</button>`; 
        container.appendChild(d); 
    });
}

export function removeFileFromQueuePI(index) { 
    state.selectedFilesQueuePI.splice(index, 1); 
    renderFileQueueUIPI(); 
}

export function setupPIUploadListeners() {
    document.getElementById('btnUploadDBPI')?.addEventListener('click', async () => {
        if (state.selectedFilesQueuePI.length === 0) return; 
        const activeNode = MODULE_CONFIG['PI'].node;
        const modal = document.getElementById('uploadProgressModal');
        const fill = document.getElementById('progressBarFill');
        const percentTxt = document.getElementById('progressPercent');
        const subTxt = document.getElementById('progressSubDetail'); 
        
        if (modal) modal.style.display = 'flex';
        
        let parsedRecords = [];
        
        for (let fIdx = 0; fIdx < state.selectedFilesQueuePI.length; fIdx++) {
            const file = state.selectedFilesQueuePI[fIdx];
            const fileBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(fileBuffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            
            if (!isValidExcelStructurePI(rows)) { 
                if (modal) modal.style.display = 'none'; 
                alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" tidak sesuai struktur Pindah Instansi (PI).`); 
                return; 
            }
            
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i]; 
                if (!row || !row[1]) continue;
                
                const instAsalClean = standardizeInstansiName(row[3]);
                const instTujuanClean = standardizeInstansiName(row[4]);
                const wilkerCalculated = getAutomaticWilker(instAsalClean, instTujuanClean);

                parsedRecords.push({ 
                    uploaded_at: new Date().toISOString(), 
                    uploader_initial: (state.currentUserInitial !== '--') ? state.currentUserInitial : 'OP', 
                    source_file: file.name, 
                    nama: normalizeValue(row[1]), 
                    nip: String(row[2] || '').replace(/'/g, '').trim(), 
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
            const CHUNK_SIZE = 150; 
            let countProcessed = 0;

            for (let i = 0; i < parsedRecords.length; i += CHUNK_SIZE) {
                const chunk = parsedRecords.slice(i, i + CHUNK_SIZE);
                const updates = {}; 

                chunk.forEach(rec => {
                    const newKey = push(ref(db, activeNode)).key; 
                    updates[`${activeNode}/${newKey}`] = rec;
                });

                await update(ref(db), updates);

                countProcessed += chunk.length;
                const progress = Math.round((countProcessed / parsedRecords.length) * 100);
                if (fill) fill.style.width = `${progress}%`; 
                if (percentTxt) percentTxt.innerText = `${progress}%`; 
                if (subTxt) subTxt.innerText = `${countProcessed} dari ${parsedRecords.length} baris terkirim`;
            }

            setTimeout(() => { 
                if (modal) modal.style.display = 'none'; 
                alert('✅ Berhasil mengunggah data Pindah Instansi ke Database!'); 
                state.selectedFilesQueuePI = []; 
                renderFileQueueUIPI(); 
            }, 500);

        } catch (e) { 
            if (modal) modal.style.display = 'none'; 
            alert(`Gagal Upload PI: ${e.message}`); 
        }
    });

    document.getElementById('formEditPI')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const dbKey = document.getElementById('editKeyPI')?.value.trim() || '';
        const rawAsal = document.getElementById('editInstansiAsalPI')?.value || '';
        const rawTujuan = document.getElementById('editInstansiTujuanPI')?.value || '';

        const instansiAsalClean = standardizeInstansiName(rawAsal);
        const instansiTujuanClean = standardizeInstansiName(rawTujuan);
        const calculatedWilker = getAutomaticWilker(instansiAsalClean, instansiTujuanClean);

        const recordPayload = {
            nama: document.getElementById('editNamaPI')?.value.trim() || '',
            nip: document.getElementById('editNipPI')?.value.trim() || '',
            instansi_asal: instansiAsalClean,
            instansi_tujuan: instansiTujuanClean,
            wilker_prov: calculatedWilker,
            tgl_validasi: document.getElementById('editTglValidasiPI')?.value.trim() || '',
            status: document.getElementById('editStatusPI')?.value.trim().toUpperCase() || 'INBOX',
            keterangan: document.getElementById('editKeteranganPI')?.value.trim() || '',
            uploader_initial: (state.currentUserInitial !== '--') ? state.currentUserInitial : 'OP',
            uploaded_at: new Date().toISOString()
        };

        try {
            if (dbKey) {
                const oldRecord = state.dbFetchedMap ? state.dbFetchedMap[dbKey] : null;
                if (oldRecord) {
                    pushPiActionState('EDIT', [{ dbKey: dbKey, data: { ...oldRecord } }]);
                }
                await update(ref(db, `${MODULE_CONFIG['PI'].node}/${dbKey}`), recordPayload);
                alert("✅ Data Pindah Instansi berhasil diperbarui!");
            } else {
                await push(ref(db, MODULE_CONFIG['PI'].node), recordPayload);
                alert("✅ Data Pindah Instansi baru berhasil ditambahkan!");
            }
            closeEditFormPI();
        } catch (err) {
            alert("❌ Gagal menyimpan data: " + err.message);
        }
    });

    document.getElementById('btnDeleteSelectedPI')?.addEventListener('click', async () => {
        if (state.selectedDbKeys.size === 0) {
            alert("⚠️ Silakan centang minimal satu data PI yang ingin dihapus.");
            return;
        }

        if (!confirm(`🗑️ Apakah Anda yakin ingin menghapus ${state.selectedDbKeys.size} data Pindah Instansi (PI) yang dipilih?`)) return; 

        const btn = document.getElementById('btnDeleteSelectedPI');
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'Menghapus...';
        }

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
                pushPiActionState('DELETE', deletedItemsSnapshot);
            }

            await Promise.all(Array.from(state.selectedDbKeys).map(k => remove(ref(db, `${MODULE_CONFIG['PI'].node}/${k}`)))); 
            
            state.selectedDbKeys.clear(); 
            if (document.getElementById('selectAllPI')) document.getElementById('selectAllPI').checked = false;
            
            updateDeleteBtnUI(); 
            alert("✅ Data Pindah Instansi terpilih berhasil dihapus!");
        } catch (e) { 
            alert(`❌ Gagal menghapus data PI: ${e.message}`); 
        } finally { 
            if (btn) {
                btn.disabled = false; 
                btn.innerHTML = '🗑️ Hapus Terpilih PI (<span id="selectedCountPI">0</span>)';
            }
        }
    });
}

if (typeof window !== 'undefined') {
    window.removeFileFromQueuePI = removeFileFromQueuePI;
}
