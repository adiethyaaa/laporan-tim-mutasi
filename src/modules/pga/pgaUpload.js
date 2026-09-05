import { db, ref, push, update } from "../../services/firebase.js";
import { state } from "../../services/store.js";
import { MODULE_CONFIG } from "../../config/constants.js";
import { 
    normalizeValue, 
    formatTanggal, 
    formatFileSize, 
    standardizeInstansiName 
} from "../../utils/formatters.js";
import { isValidExcelStructurePGA } from "../../utils/excelParser.js";

export function setupToggleUploadFormPGA() {
    const btn = document.getElementById('btnToggleUploadFormPGA');
    const wrapper = document.getElementById('uploadFormWrapperPGA');
    if (btn && wrapper) {
        btn.addEventListener('click', () => {
            const isHidden = (wrapper.style.display === 'none' || !wrapper.style.display);
            wrapper.style.display = isHidden ? 'block' : 'none';
            const icon = document.getElementById('toggleIconPGA');
            const text = document.getElementById('toggleTextPGA');
            if (icon) icon.innerHTML = isHidden ? '<i class="fas fa-eye-slash"></i>' : '<i class="fas fa-eye"></i>';
            if (text) text.innerText = isHidden ? 'Sembunyikan Form Upload PGA' : 'Tampilkan Form Upload PGA';
        });
    }
}

export function setupDragAndDropPGA() {
    const dropZone = document.getElementById('dropZonePGA');
    const fileInput = document.getElementById('uploadPGA'); 
    if (!dropZone || !fileInput) return;
    
    dropZone.addEventListener('click', () => fileInput.click()); 
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, evt => { evt.preventDefault(); evt.stopPropagation(); }));
    ['dragenter', 'dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('dragover'))); 
    ['dragleave', 'drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('dragover')));
    
    dropZone.addEventListener('drop', e => handleNewFilesPGA(Array.from(e.dataTransfer.files))); 
    fileInput.addEventListener('change', e => { handleNewFilesPGA(Array.from(e.target.files)); e.target.value = ''; });
}

export async function handleNewFilesPGA(files) {
    if (!files || files.length === 0) return;
    for (let file of files) {
        if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
            const buffer = await file.arrayBuffer(); 
            const workbook = XLSX.read(buffer, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            
            if (!isValidExcelStructurePGA(rows)) { 
                alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" tidak sesuai format tabel Usulan PGA.\nPastikan kolom memuat: NO, VALIDATOR, NAMA, NIP, INSTANSI, TGL USUL, STATUS, KETERANGAN.`); 
                continue; 
            }
            if (!state.selectedFilesQueuePGA.some(f => f.name === file.name && f.size === file.size)) {
                state.selectedFilesQueuePGA.push(file);
            }
        } else { 
            alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" bukan berkas Excel (.xlsx / .xls).`); 
        }
    }
    renderFileQueueUIPGA();
}

export function renderFileQueueUIPGA() {
    const queueCard = document.getElementById('fileQueueCardPGA');
    const container = document.getElementById('fileListContainerPGA'); 
    if (!queueCard || !container) return;
    
    if (state.selectedFilesQueuePGA.length === 0) { 
        queueCard.style.display = 'none'; 
        return; 
    }
    
    queueCard.style.display = 'block'; 
    const countEl = document.getElementById('fileCountTextPGA');
    if (countEl) countEl.innerText = state.selectedFilesQueuePGA.length; 
    container.innerHTML = '';
    
    state.selectedFilesQueuePGA.forEach((file, index) => { 
        const d = document.createElement('div'); 
        d.className = 'file-item'; 
        d.innerHTML = `
            <div class="file-info">
                <span>🎓</span>
                <span class="file-name">${file.name}</span>
                <span class="file-size">(${formatFileSize(file.size)})</span>
            </div>
            <button class="btn-remove-file" onclick="removeFileFromQueuePGA(${index})" title="Hapus Berkas">❌</button>
        `; 
        container.appendChild(d); 
    });
}

export function removeFileFromQueuePGA(index) { 
    state.selectedFilesQueuePGA.splice(index, 1); 
    renderFileQueueUIPGA(); 
}

export function setupPGAUploadListeners() {
    setupToggleUploadFormPGA();
    setupDragAndDropPGA();

    const btnUpload = document.getElementById('btnUploadDBPGA');
    if (btnUpload) {
        btnUpload.addEventListener('click', async () => {
            if (state.selectedFilesQueuePGA.length === 0) {
                alert("⚠️ Belum ada file Excel PGA yang dipilih.");
                return;
            }

            const activeNode = MODULE_CONFIG['PGA']?.node || 'usulan_pga';
            const modal = document.getElementById('uploadProgressModal');
            const fill = document.getElementById('progressBarFill');
            const percentTxt = document.getElementById('progressPercent');
            const subTxt = document.getElementById('progressSubDetail'); 
            
            if (modal) modal.style.display = 'flex';
            
            let parsedRecords = [];
            
            for (let fIdx = 0; fIdx < state.selectedFilesQueuePGA.length; fIdx++) {
                const file = state.selectedFilesQueuePGA[fIdx];
                const fileBuffer = await file.arrayBuffer();
                const workbook = XLSX.read(fileBuffer, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                
                if (!isValidExcelStructurePGA(rows)) { 
                    if (modal) modal.style.display = 'none'; 
                    alert(`⚠️ BERKAS DITOLAK!\nFile "${file.name}" tidak sesuai format tabel Usulan PGA.`); 
                    return; 
                }

                // Cari baris header
                let headerRowIdx = 0;
                for (let r = 0; r < Math.min(rows.length, 3); r++) {
                    if (Array.isArray(rows[r])) {
                        const h = rows[r].map(c => String(c || '').toUpperCase().trim());
                        if (h.some(item => item.includes('NAMA')) && h.some(item => item.includes('NIP'))) {
                            headerRowIdx = r;
                            break;
                        }
                    }
                }

                const header = rows[headerRowIdx].map(c => String(c || '').toUpperCase().trim());
                
                // Indeks kolom dinamis dengan fallback ke posisi standar
                let colValidator = header.findIndex(h => h.includes('VALIDATOR') || h.includes('ID USER') || h === 'ID');
                let colNama = header.findIndex(h => h.includes('NAMA'));
                let colNip = header.findIndex(h => h.includes('NIP'));
                let colInstansi = header.findIndex(h => h.includes('INSTANSI') || h.includes('PEMDA'));
                let colTglUsul = header.findIndex(h => h.includes('TANGGAL') || h.includes('TGL'));
                let colStatus = header.findIndex(h => h.includes('STATUS'));
                let colKeterangan = header.findIndex(h => h.includes('KETERANGAN') || h.includes('KET'));

                // Fallbacks jika header tidak terdeteksi presisi
                if (colValidator === -1) colValidator = 1;
                if (colNama === -1) colNama = 2;
                if (colNip === -1) colNip = 3;
                if (colInstansi === -1) colInstansi = 4;
                if (colTglUsul === -1) colTglUsul = 5;
                if (colStatus === -1) colStatus = 6;
                if (colKeterangan === -1) colKeterangan = 7;
                
                for (let i = headerRowIdx + 1; i < rows.length; i++) {
                    const row = rows[i]; 
                    if (!row || !row[colNama]) continue;
                    
                    const rawNama = normalizeValue(row[colNama]);
                    if (rawNama === '--' || rawNama === '') continue;

                    const rawValidator = String(row[colValidator] || state.currentUserInitial || 'OP').trim().toUpperCase();
                    const rawNip = String(row[colNip] || '').replace(/['\s]/g, '').trim();
                    const rawInstansi = standardizeInstansiName(row[colInstansi]);
                    const rawTglUsul = formatTanggal(row[colTglUsul]);
                    
                    let rawStatus = String(row[colStatus] || 'INBOX').trim().toUpperCase();
                    if (rawStatus === 'ACC') rawStatus = 'MS';
                    if (!['MS', 'TMS', 'BTS', 'INBOX'].includes(rawStatus)) {
                        if (rawStatus.includes('SETUJU') || rawStatus.includes('MS')) rawStatus = 'MS';
                        else if (rawStatus.includes('TOLAK') || rawStatus.includes('TMS')) rawStatus = 'TMS';
                        else if (rawStatus.includes('PERBAIKAN') || rawStatus.includes('BTS')) rawStatus = 'BTS';
                        else rawStatus = 'INBOX';
                    }

                    const rawKeterangan = normalizeValue(row[colKeterangan]);

                    parsedRecords.push({ 
                        uploaded_at: new Date().toISOString(), 
                        uploader_initial: (state.currentUserInitial !== '--') ? state.currentUserInitial : 'OP', 
                        source_file: file.name, 
                        validator: rawValidator,
                        nama: rawNama, 
                        nip: rawNip, 
                        instansi: rawInstansi, 
                        tgl_usul: rawTglUsul, 
                        status: rawStatus, 
                        keterangan: rawKeterangan 
                    });
                }
            }
            
            if (parsedRecords.length === 0) { 
                if (modal) modal.style.display = 'none'; 
                alert('File Excel PGA kosong atau tidak memiliki baris data valid.'); 
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
                    if (subTxt) subTxt.innerText = `${countProcessed} dari ${parsedRecords.length} baris PGA terkirim`;
                }

                setTimeout(() => { 
                    if (modal) modal.style.display = 'none'; 
                    alert('✅ Berhasil mengunggah data Usulan PGA ke Database!'); 
                    state.selectedFilesQueuePGA = []; 
                    renderFileQueueUIPGA(); 
                }, 500);

            } catch (e) { 
                if (modal) modal.style.display = 'none'; 
                alert(`❌ Gagal Upload PGA: ${e.message}`); 
            }
        });
    }
}

// Pasang ke window agar onclick HTML dapat mengakses langsung
if (typeof window !== 'undefined') {
    window.removeFileFromQueuePGA = removeFileFromQueuePGA;
}
