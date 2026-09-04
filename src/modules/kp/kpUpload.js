import { db, ref, push, update, remove, set } from "../../services/firebase.js";
import { state } from "../../services/store.js";
import { MODULE_CONFIG } from "../../config/constants.js";
import { 
    normalizeValue, 
    formatTanggal, 
    formatFileSize, 
    categoriseStatus, 
    calculatePeriodeKP 
} from "../../utils/formatters.js";
import { isValidExcelStructure } from "../../utils/excelParser.js";
import { updateDeleteBtnUI } from "./kpController.js";

export function setupToggleUploadForm() {
    const btnKP = document.getElementById('btnToggleUploadForm');
    const wrapperKP = document.getElementById('uploadFormWrapper');
    if (btnKP && wrapperKP) { 
        btnKP.addEventListener('click', () => { 
            wrapperKP.style.display = wrapperKP.style.display === 'none' ? 'block' : 'none'; 
            document.getElementById('toggleIcon').innerHTML = wrapperKP.style.display === 'none' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>'; 
            document.getElementById('toggleText').innerText = wrapperKP.style.display === 'none' ? 'Tampilkan Form KP' : 'Sembunyikan Form KP'; 
        }); 
    }
    
    const btnPI = document.getElementById('btnToggleUploadFormPI');
    const wrapperPI = document.getElementById('uploadFormWrapperPI');
    if (btnPI && wrapperPI) { 
        btnPI.addEventListener('click', () => { 
            wrapperPI.style.display = wrapperPI.style.display === 'none' ? 'block' : 'none'; 
            document.getElementById('toggleIconPI').innerHTML = wrapperPI.style.display === 'none' ? '<i class="fas fa-eye"></i>' : '<i class="fas fa-eye-slash"></i>'; 
            document.getElementById('toggleTextPI').innerText = wrapperPI.style.display === 'none' ? 'Tampilkan Form PI' : 'Sembunyikan Form PI'; 
        }); 
    }
}

export function setupDragAndDrop() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('uploadKP'); 
    if (!dropZone || !fileInput) return;
    
    dropZone.addEventListener('click', () => fileInput.click()); 
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, evt => { evt.preventDefault(); evt.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('dragover'))); 
    ['dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('dragover')));
    
    dropZone.addEventListener('drop', e => handleNewFiles(Array.from(e.dataTransfer.files))); 
    fileInput.addEventListener('change', e => { handleNewFiles(Array.from(e.target.files)); e.target.value = ''; });
}

export async function handleNewFiles(files) {
    if (files.length === 0) return;
    for (let file of files) {
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const buffer = await file.arrayBuffer(); 
            const rows = XLSX.utils.sheet_to_json(XLSX.read(buffer, { type: 'array' }).Sheets[XLSX.read(buffer, { type: 'array' }).SheetNames[0]], { header: 1 });
            if (!isValidExcelStructure(rows)) { 
                alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" ditolak karena KOSONG atau format Excel tidak sesuai.`); 
                continue; 
            }
            if (!state.selectedFilesQueue.some(f => f.name === file.name && f.size === file.size)) {
                state.selectedFilesQueue.push(file);
            }
        } else { 
            alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" bukan Excel.`); 
        }
    }
    renderFileQueueUI();
}

export function renderFileQueueUI() {
    const queueCard = document.getElementById('fileQueueCard');
    const container = document.getElementById('fileListContainer'); 
    if (!queueCard || !container) return;
    
    if (state.selectedFilesQueue.length === 0) { 
        queueCard.style.display = 'none'; 
        return; 
    }
    
    queueCard.style.display = 'block'; 
    document.getElementById('fileCountText').innerText = state.selectedFilesQueue.length; 
    container.innerHTML = '';
    
    state.selectedFilesQueue.forEach((file, index) => { 
        const d = document.createElement('div'); 
        d.className = 'file-item'; 
        d.innerHTML = `<div class="file-info"><span>📊</span><span class="file-name">${file.name}</span><span class="file-size">(${formatFileSize(file.size)})</span></div><button class="btn-remove-file" onclick="removeFileFromQueue(${index})">❌</button>`; 
        container.appendChild(d); 
    });
}

export function removeFileFromQueue(index) { 
    state.selectedFilesQueue.splice(index, 1); 
    renderFileQueueUI(); 
}

export function updateUndoButtonUI() { 
    if (document.getElementById('btnUndo')) {
        document.getElementById('btnUndo').style.display = state.previousDbSnapshot !== null ? 'inline-block' : 'none'; 
    }
}

export function setupKPUploadListeners() {
    document.getElementById('btnUploadDB')?.addEventListener('click', async () => {
        if (state.selectedFilesQueue.length === 0) return;
        
        const activeNode = MODULE_CONFIG['KP'].node; 
        state.previousDbSnapshot = JSON.parse(JSON.stringify(state.dbFetchedMap || {})); 
        updateUndoButtonUI();
        
        const modal = document.getElementById('uploadProgressModal');
        const fill = document.getElementById('progressBarFill');
        const percentTxt = document.getElementById('progressPercent');
        const subTxt = document.getElementById('progressSubDetail');
              
        if (modal) modal.style.display = 'flex'; 
        if (fill) fill.style.width = '0%'; 
        if (percentTxt) percentTxt.innerText = '0%';
        
        let parsedRecords = [];
        for (let fIdx = 0; fIdx < state.selectedFilesQueue.length; fIdx++) {
            const rows = XLSX.utils.sheet_to_json(XLSX.read(await state.selectedFilesQueue[fIdx].arrayBuffer(), { type: 'array' }).Sheets[XLSX.read(await state.selectedFilesQueue[fIdx].arrayBuffer(), { type: 'array' }).SheetNames[0]], { header: 1 });
            
            for (let i = 3; i < rows.length; i++) {
                const row = rows[i]; 
                if (!row || !row[0]) continue;
                const tglUsul = formatTanggal(row[5]);
                const rawStatus = normalizeValue(row[6]);
                parsedRecords.push({ 
                    uploaded_at: new Date().toISOString(), 
                    uploader_initial: (state.currentUserInitial !== '--') ? state.currentUserInitial : 'OP', 
                    source_file: state.selectedFilesQueue[fIdx].name, 
                    instansi_induk: normalizeValue(row[0]), 
                    instansi_kerja: normalizeValue(row[1]), 
                    unor_nama: normalizeValue(row[2]), 
                    unor_induk_nama: normalizeValue(row[3]), 
                    tgl_usulan: formatTanggal(row[4]), 
                    tgl_pengiriman_kelayanan: tglUsul, 
                    periode_kp: calculatePeriodeKP(tglUsul), 
                    status_usulan: rawStatus, 
                    kategori_status: categoriseStatus(rawStatus), 
                    no_pertek: normalizeValue(row[7]), 
                    tgl_pertek: formatTanggal(row[8]), 
                    gelar_depan: normalizeValue(row[9]), 
                    gelar_belakang: normalizeValue(row[10]), 
                    nama: normalizeValue(row[11]), 
                    nip: normalizeValue(row[12]), 
                    tempat_lahir: normalizeValue(row[13]), 
                    tgl_lahir: formatTanggal(row[14]), 
                    pendidikan: row[15] ? `${row[15]} (${row[16] || ''})` : '--', 
                    gol_tmt_lama: `${normalizeValue(row[17])} / ${formatTanggal(row[18])}`, 
                    pangkat_lama: normalizeValue(row[19]), 
                    jabatan_lama: normalizeValue(row[23]), 
                    gol_tmt_baru: `${normalizeValue(row[25])} / ${formatTanggal(row[26])}`, 
                    pangkat_baru: normalizeValue(row[27]), 
                    jabatan_baru: normalizeValue(row[31]), 
                    no_sk: normalizeValue(row[33]), 
                    tgl_sk: formatTanggal(row[34]), 
                    pejabat_ttd_pertek: normalizeValue(row[36]), 
                    kppn: normalizeValue(row[37]), 
                    jenis_prosedur: normalizeValue(row[38]), 
                    jenis_kp: normalizeValue(row[39]), 
                    alasan_tolak: normalizeValue(row[40]), 
                    verifikator_nip: normalizeValue(row[41]), 
                    verifikator_nama: normalizeValue(row[42]), 
                    kanreg_operator: normalizeValue(row[43]), 
                    uraian_perbaikan_pertek_instansi: normalizeValue(row[44]), 
                    uraian_pembatalan_pertek_instansi: normalizeValue(row[45]), 
                    tgl_ttd_pertek: formatTanggal(row[46]), 
                    status_kpo: normalizeValue(row[47]), 
                    raw_columns: row.map(c => normalizeValue(c)) 
                });
            }
        }
        
        if (parsedRecords.length === 0) { 
            if (modal) modal.style.display = 'none'; 
            return alert('Data usulan kosong.'); 
        }
        
        const existingNipMap = {}; 
        Object.keys(state.dbFetchedMap || {}).forEach(key => { 
            if (state.dbFetchedMap[key].nip !== '--') {
                existingNipMap[state.dbFetchedMap[key].nip] = { key, record: state.dbFetchedMap[key] }; 
            }
        });
        
        let dupes = parsedRecords.filter(item => existingNipMap[item.nip]).length;
        if (dupes > 0) { 
            if (modal) modal.style.display = 'none'; 
            if (!confirm(`Terdapat ${dupes} NIP sama. Timpa data lama?`)) return; 
            if (modal) modal.style.display = 'flex'; 
        }
        
        try {
            const CHUNK_SIZE = 150; 
            let countProcessed = 0;

            for (let i = 0; i < parsedRecords.length; i += CHUNK_SIZE) {
                const chunk = parsedRecords.slice(i, i + CHUNK_SIZE);
                const updates = {};

                chunk.forEach(rec => {
                    const ext = existingNipMap[rec.nip];
                    if (ext && new Date(rec.tgl_pengiriman_kelayanan !== '--' ? rec.tgl_pengiriman_kelayanan : 0) >= new Date(ext.record.tgl_pengiriman_kelayanan !== '--' ? ext.record.tgl_pengiriman_kelayanan : 0)) {
                        updates[`${activeNode}/${ext.key}`] = rec;
                    } else if (!ext) {
                        const newKey = push(ref(db, activeNode)).key; 
                        updates[`${activeNode}/${newKey}`] = rec;
                    }
                });

                await update(ref(db), updates); 

                countProcessed += chunk.length;
                const progress = Math.round((countProcessed / parsedRecords.length) * 100);
                if (fill) fill.style.width = `${progress}%`;
                if (percentTxt) percentTxt.innerText = `${progress}%`;
                if (subTxt) subTxt.innerText = `${countProcessed} dari ${parsedRecords.length} data terkirim`;
            }

            setTimeout(() => { 
                if (modal) modal.style.display = 'none'; 
                state.selectedFilesQueue = []; 
                renderFileQueueUI(); 
                alert('✅ Berhasil mengunggah data KP ke Database!');
            }, 500);

        } catch (e) { 
            if (modal) modal.style.display = 'none'; 
            alert(`Gagal Upload: ${e.message}`); 
        }
    });

    document.getElementById('btnUndo')?.addEventListener('click', async () => {
        if (!state.previousDbSnapshot || !confirm("Undo database?")) return;
        const btn = document.getElementById('btnUndo'); 
        btn.innerText = 'Proses...'; 
        btn.disabled = true;
        
        try { 
            await set(ref(db, MODULE_CONFIG['KP'].node), state.previousDbSnapshot); 
            alert("Berhasil undo!"); 
            state.previousDbSnapshot = null; 
            updateUndoButtonUI(); 
        } catch (e) { 
            alert(`Gagal Undo: ${e.message}`); 
        } finally { 
            btn.innerText = '↩ Undo Perubahan'; 
            btn.disabled = false; 
        }
    });

    document.getElementById('btnDeleteSelected')?.addEventListener('click', async () => {
        if (state.selectedDbKeys.size === 0 || !confirm(`Apakah Anda yakin ingin menghapus ${state.selectedDbKeys.size} data usulan KP yang dipilih?`)) return; 
        
        state.previousDbSnapshot = JSON.parse(JSON.stringify(state.dbFetchedMap || {})); 
        updateUndoButtonUI();
        document.getElementById('btnDeleteSelected').disabled = true;
        
        try { 
            await Promise.all(Array.from(state.selectedDbKeys).map(k => remove(ref(db, `${MODULE_CONFIG['KP'].node}/${k}`)))); 
            state.selectedDbKeys.clear(); 
            updateDeleteBtnUI(); 
            alert("✅ Data KP terpilih berhasil dihapus!");
        } catch (e) { 
            alert(`❌ Gagal menghapus data KP: ${e.message}`); 
        } finally { 
            document.getElementById('btnDeleteSelected').disabled = false; 
        }
    });
}

if (typeof window !== 'undefined') {
    window.removeFileFromQueue = removeFileFromQueue;
}
