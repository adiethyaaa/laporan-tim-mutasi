import { state } from "../../services/store.js";
import { 
    cleanInstansiName, 
    formatJenisKP, 
    calculatePeriodeKP, 
    categoriseStatus, 
    formatTanggal, 
    normalizeValue 
} from "../../utils/formatters.js";
import { isEligibleForApp, checkIsKPO } from "../../utils/eligibility.js";
import { 
    REGION_PAPUA_BARAT, 
    REGION_PAPUA_BARAT_DAYA, 
    REGION_INSTANSI_VERTIKAL 
} from "../../config/constants.js";

let currentInstansiDataList = [];
let instansiSortCol = 'Total';
let instansiSortAsc = false;

let currentDetailSummaryDataList = [];
let detailSummarySortCol = 'tgl_pengiriman_kelayanan';
let detailSummarySortAsc = false;

export function openSummaryTableModal(filterType, filterValue) {
    const selectedInstansi = document.getElementById('dashFilterInstansi')?.value;
    const selectedPeriodeKP = document.getElementById('dashFilterPeriodeKP')?.value;
    const dateFromVal = document.getElementById('dashDateFrom')?.value;
    const dateToVal = document.getElementById('dashDateTo')?.value;

    const filtered = state.combinedDataList.filter(item => {
        if (!isEligibleForApp(item)) return false;
        if (!state.includeKPO && checkIsKPO(item)) return false;
        
        if (filterType === 'kategori' && item.kategori_status !== filterValue) return false;
        if (filterType === 'jenis' && formatJenisKP(item.jenis_kp) !== filterValue) return false;
        if (selectedInstansi && selectedInstansi.trim() !== '' && item.instansi_induk !== selectedInstansi) return false;

        if (selectedPeriodeKP && selectedPeriodeKP.trim() !== '') {
            const periodeItem = String(item.periode_kp || item.periode || calculatePeriodeKP(item.tgl_pengiriman_kelayanan) || '').trim().toUpperCase();
            const targetPeriode = selectedPeriodeKP.trim().toUpperCase();
            if (!periodeItem.includes(targetPeriode)) return false;
        }

        const tglStr = item.tgl_pengiriman_kelayanan;
        if (tglStr && tglStr !== '--') {
            if (dateFromVal && tglStr < dateFromVal) return false;
            if (dateToVal && tglStr > dateToVal) return false;
        }

        return true;
    });

    const titleEl = document.getElementById('summaryModalTitle'); 
    if (titleEl) {
        titleEl.innerText = `Daftar Usulan: ${filterValue} (${filtered.length} Data)`;
    }

    currentDetailSummaryDataList = filtered; 
    detailSummarySortCol = 'tgl_pengiriman_kelayanan'; 
    detailSummarySortAsc = false; 

    renderDetailSummaryTable();

    const modal = document.getElementById('summaryTableModal'); 
    if (modal) { 
        modal.style.display = 'flex'; 
        const innerContent = modal.querySelector('.modal-content'); 
        if (innerContent) innerContent.style.display = 'block'; 
    }
}

export function openRekapAngkaModal() {
    const activeDataList = Array.isArray(state.currentDashboardFilteredData) && state.currentDashboardFilteredData.length > 0
        ? state.currentDashboardFilteredData
        : (state.combinedDataList ? state.combinedDataList.filter(i => {
              if (!isEligibleForApp(i)) return false;
              if (!state.includeKPO && checkIsKPO(i)) return false;
              return true;
          }) : []);
        
    const dateTextHtml = getExportHeaderDateText(activeDataList);
    
    const elDateA = document.getElementById('modalRekapDateTextA');
    const elDateB = document.getElementById('modalRekapDateTextB');
    if (elDateA) elDateA.innerHTML = dateTextHtml;
    if (elDateB) elDateB.innerHTML = dateTextHtml;

    const regionMap = {
        'Prov. Papua Barat': REGION_PAPUA_BARAT.map(n => cleanInstansiName(n)),
        'Prov. Papua Barat Daya': REGION_PAPUA_BARAT_DAYA.map(n => cleanInstansiName(n)),
        'Instansi Vertikal': REGION_INSTANSI_VERTIKAL.map(n => cleanInstansiName(n))
    };

    const statsByRegion = {
        'Prov. Papua Barat': { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Reguler: 0, Ijazah: 0, JF: 0, Struktural: 0 },
        'Prov. Papua Barat Daya': { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Reguler: 0, Ijazah: 0, JF: 0, Struktural: 0 },
        'Instansi Vertikal': { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Reguler: 0, Ijazah: 0, JF: 0, Struktural: 0 },
        'Lainnya / Tidak Terdefinisi': { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Reguler: 0, Ijazah: 0, JF: 0, Struktural: 0 }
    };

    activeDataList.forEach(item => {
        const cleanInst = cleanInstansiName(item.instansi_induk);
        let matchedRegion = 'Lainnya / Tidak Terdefinisi';

        for (const [regName, instList] of Object.entries(regionMap)) {
            if (instList.includes(cleanInst)) {
                matchedRegion = regName;
                break;
            }
        }

        const statusKat = item.kategori_status;
        if (statusKat === 'MS') statsByRegion[matchedRegion].MS++;
        else if (statusKat === 'BTS') statsByRegion[matchedRegion].BTS++;
        else if (statusKat === 'TMS') statsByRegion[matchedRegion].TMS++;
        else statsByRegion[matchedRegion].Inbox++;

        const jenis = formatJenisKP(item.jenis_kp);
        if (jenis === 'KP Reguler') statsByRegion[matchedRegion].Reguler++;
        else if (jenis === 'KP Penyesuaian Ijazah') statsByRegion[matchedRegion].Ijazah++;
        else if (jenis === 'KP JF') statsByRegion[matchedRegion].JF++;
        else if (jenis === 'KP Struktural') statsByRegion[matchedRegion].Struktural++;
    });

    const tbodyStatus = document.getElementById('tbodyRekapStatusRegional');
    if (tbodyStatus) tbodyStatus.innerHTML = '';

    let sumMs = 0, sumBts = 0, sumTms = 0, sumInbox = 0, sumGrandTotalStatus = 0;

    Object.keys(statsByRegion).forEach(regKey => {
        const d = statsByRegion[regKey];
        const rowTotal = d.MS + d.BTS + d.TMS + d.Inbox;
        
        if (rowTotal > 0 || regKey !== 'Lainnya / Tidak Terdefinisi') {
            sumMs += d.MS; sumBts += d.BTS; sumTms += d.TMS; sumInbox += d.Inbox; sumGrandTotalStatus += rowTotal;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-region"><strong>${regKey}</strong></td>
                <td class="col-num" style="color: #16a34a; font-weight: bold;">${d.MS}</td>
                <td class="col-num" style="color: #d97706; font-weight: bold;">${d.BTS}</td>
                <td class="col-num" style="color: #dc2626; font-weight: bold;">${d.TMS}</td>
                <td class="col-num" style="color: #2563eb; font-weight: bold;">${d.Inbox}</td>
                <td class="col-num td-total-col" style="font-weight: bold;">${rowTotal}</td>
            `;
            tbodyStatus.appendChild(tr);
        }
    });

    if (document.getElementById('rekMs')) document.getElementById('rekMs').innerText = sumMs;
    if (document.getElementById('rekBts')) document.getElementById('rekBts').innerText = sumBts;
    if (document.getElementById('rekTms')) document.getElementById('rekTms').innerText = sumTms;
    if (document.getElementById('rekInbox')) document.getElementById('rekInbox').innerText = sumInbox;
    if (document.getElementById('rekTotalStatus')) document.getElementById('rekTotalStatus').innerText = sumGrandTotalStatus;

    const tbodyJenis = document.getElementById('tbodyRekapJenisRegional');
    if (tbodyJenis) tbodyJenis.innerHTML = '';

    let sumReg = 0, sumIj = 0, sumJf = 0, sumStruk = 0, sumGrandTotalJenis = 0;

    Object.keys(statsByRegion).forEach(regKey => {
        const d = statsByRegion[regKey];
        const rowTotal = d.Reguler + d.Ijazah + d.JF + d.Struktural;

        if (rowTotal > 0 || regKey !== 'Lainnya / Tidak Terdefinisi') {
            sumReg += d.Reguler; sumIj += d.Ijazah; sumJf += d.JF; sumStruk += d.Struktural; sumGrandTotalJenis += rowTotal;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-region"><strong>${regKey}</strong></td>
                <td class="col-num">${d.Reguler}</td>
                <td class="col-num">${d.Ijazah}</td>
                <td class="col-num">${d.JF}</td>
                <td class="col-num">${d.Struktural}</td>
                <td class="col-num td-total-col" style="font-weight: bold;">${rowTotal}</td>
            `;
            tbodyJenis.appendChild(tr);
        }
    });

    if (document.getElementById('rekReg')) document.getElementById('rekReg').innerText = sumReg;
    if (document.getElementById('rekIj')) document.getElementById('rekIj').innerText = sumIj;
    if (document.getElementById('rekJf')) document.getElementById('rekJf').innerText = sumJf;
    if (document.getElementById('rekStruk')) document.getElementById('rekStruk').innerText = sumStruk;
    if (document.getElementById('rekTotalJenis')) document.getElementById('rekTotalJenis').innerText = sumGrandTotalJenis;

    const modal = document.getElementById('rekapAngkaModal');
    if (modal) {
        modal.style.display = 'flex';
        const innerContent = modal.querySelector('.modal-content');
        if (innerContent) innerContent.style.display = 'block';
    }
}

export function openRekapInstansiModal() {
    const angkaModal = document.getElementById('rekapAngkaModal'); 
    if (angkaModal) angkaModal.style.display = 'none';
    const instansiModal = document.getElementById('rekapInstansiModal'); 
    if (!instansiModal) return;

    const selectedFilterInstansi = document.getElementById('dashFilterInstansi')?.value;
    const selectedPeriodeKP = document.getElementById('dashFilterPeriodeKP')?.value;
    const dateFromVal = document.getElementById('dashDateFrom')?.value;
    const dateToVal = document.getElementById('dashDateTo')?.value;
    const instansiMap = {};

    state.combinedDataList.forEach(item => {
        if (!isEligibleForApp(item)) return;
        if (!state.includeKPO && checkIsKPO(item)) return;
        
        if (selectedFilterInstansi && item.instansi_induk !== selectedFilterInstansi) return;
        if (selectedPeriodeKP) {
            const periodeItem = String(item.periode_kp || item.periode || '').trim().toUpperCase();
            if (!periodeItem.includes(selectedPeriodeKP.toUpperCase())) return;
        }
        
        const tglStr = item.tgl_pengiriman_kelayanan;
        if (tglStr && tglStr !== '--') {
            if (dateFromVal && tglStr < dateFromVal) return;
            if (dateToVal && tglStr > dateToVal) return;
        }
        
        const fullInst = item.instansi_induk;
        if (fullInst && fullInst !== '--') {
            const cleanName = cleanInstansiName(fullInst);
            if (!instansiMap[cleanName]) {
                instansiMap[cleanName] = { fullInst: fullInst, name: cleanName, MS: 0, BTS: 0, TMS: 0, Inbox: 0, Total: 0 };
            }
            
            const status = item.kategori_status;
            if (status === 'MS') instansiMap[cleanName].MS++; 
            else if (status === 'BTS') instansiMap[cleanName].BTS++; 
            else if (status === 'TMS') instansiMap[cleanName].TMS++; 
            else instansiMap[cleanName].Inbox++; 
            
            instansiMap[cleanName].Total++;
        }
    });

    currentInstansiDataList = Object.values(instansiMap); 
    instansiSortCol = 'Total'; 
    instansiSortAsc = false; 
    renderRekapInstansiTable();
    
    instansiModal.style.display = 'flex'; 
    const innerCard = instansiModal.querySelector('.modal-content'); 
    if (innerCard) innerCard.style.display = 'block';
}

export function sortRekapInstansiTable(colName) { 
    if (instansiSortCol === colName) { 
        instansiSortAsc = !instansiSortAsc; 
    } else { 
        instansiSortCol = colName; 
        instansiSortAsc = (colName === 'name'); 
    } 
    renderRekapInstansiTable(); 
}

export function renderRekapInstansiTable() {
    currentInstansiDataList.sort((a, b) => { 
        let valA = a[instansiSortCol], valB = b[instansiSortCol]; 
        if (typeof valA === 'string') return instansiSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA); 
        return instansiSortAsc ? valA - valB : valB - valA; 
    });
    
    ['name', 'MS', 'BTS', 'TMS', 'Inbox', 'Total'].forEach(c => { 
        const el = document.getElementById(`sort_inst_${c}`); 
        if (el) el.innerText = '↕'; 
    });
    
    const activeArrow = document.getElementById(`sort_inst_${instansiSortCol}`); 
    if (activeArrow) activeArrow.innerText = instansiSortAsc ? '▲' : '▼';
    
    const tbody = document.getElementById('tabelRekapInstansiBody');
    const tfoot = document.getElementById('tabelRekapInstansiFoot'); 
    if (!tbody) return; 
    tbody.innerHTML = ''; 
    if (tfoot) tfoot.innerHTML = '';
    
    if (currentInstansiDataList.length === 0) { 
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:15px; color:#7f8c8d;">Tidak ada data instansi.</td></tr>'; 
        return; 
    }
    
    let sumMs = 0, sumBts = 0, sumTms = 0, sumInbox = 0, sumGrandTotal = 0;
    currentInstansiDataList.forEach((data, idx) => {
        sumMs += data.MS; sumBts += data.BTS; sumTms += data.TMS; sumInbox += data.Inbox; sumGrandTotal += data.Total; 
        
        const tr = document.createElement('tr'); 
        const safeFullInst = data.fullInst.replace(/'/g, "\\'");
        tr.innerHTML = `
            <td style="text-align: center;">${idx + 1}</td>
            <td><span class="clickable-instansi-link" style="color:#0284c7; cursor:pointer; font-weight:bold;" onclick="window.openDetailInstansiSummaryModal('${safeFullInst}')">${data.name} 🔍</span></td>
            <td style="text-align: center; color: #16a34a; font-weight: bold;">${data.MS}</td>
            <td style="text-align: center; color: #d97706; font-weight: bold;">${data.BTS}</td>
            <td style="text-align: center; color: #dc2626; font-weight: bold;">${data.TMS}</td>
            <td style="text-align: center; color: #2563eb; font-weight: bold;">${data.Inbox}</td>
            <td class="td-total-col" style="text-align: center; font-weight: bold;">${data.Total}</td>
        `; 
        tbody.appendChild(tr);
    });
    
    if (tfoot) { 
        tfoot.innerHTML = `
            <tr style="background: #f8fafc; font-weight: bold;">
                <td colspan="2" style="text-align: right; padding-right: 15px;">TOTAL KESELURUHAN:</td>
                <td style="text-align: center; color: #16a34a; font-weight: 800;">${sumMs}</td>
                <td style="text-align: center; color: #d97706; font-weight: 800;">${sumBts}</td>
                <td style="text-align: center; color: #dc2626; font-weight: 800;">${sumTms}</td>
                <td style="text-align: center; color: #2563eb; font-weight: 800;">${sumInbox}</td>
                <td class="td-total-col" style="text-align: center; font-size: 13px; font-weight: 800;">${sumGrandTotal}</td>
            </tr>
        `; 
    }
}

export function openDetailInstansiSummaryModal(fullInstansiName) {
    const selectedPeriodeKP = document.getElementById('dashFilterPeriodeKP')?.value;
    const dateFromVal = document.getElementById('dashDateFrom')?.value;
    const dateToVal = document.getElementById('dashDateTo')?.value;

    const filtered = state.combinedDataList.filter(item => {
        if (!isEligibleForApp(item)) return false;
        if (!state.includeKPO && checkIsKPO(item)) return false;
        
        if (item.instansi_induk !== fullInstansiName) return false;
        if (selectedPeriodeKP) {
            const periodeItem = String(item.periode_kp || item.periode || '').trim().toUpperCase();
            if (!periodeItem.includes(selectedPeriodeKP.toUpperCase())) return false;
        }
        
        const tglStr = item.tgl_pengiriman_kelayanan;
        if (tglStr && tglStr !== '--') {
            if (dateFromVal && tglStr < dateFromVal) return false;
            if (dateToVal && tglStr > dateToVal) return false;
        }
        return true;
    });

    const titleEl = document.getElementById('detailSummaryModalTitle');
    if (titleEl) {
        titleEl.innerText = `Detail Rekap Usulan: ${cleanInstansiName(fullInstansiName)} (${filtered.length} Data)`;
    }

    currentDetailSummaryDataList = filtered;
    detailSummarySortCol = 'tgl_pengiriman_kelayanan';
    detailSummarySortAsc = false;

    renderDetailSummaryTable();

    const modal = document.getElementById('summaryTableModal');
    if (modal) {
        modal.style.display = 'flex';
        const innerContent = modal.querySelector('.modal-content');
        if (innerContent) innerContent.style.display = 'block';
    }
}

export function sortDetailSummaryTable(colName) {
    if (detailSummarySortCol === colName) {
        detailSummarySortAsc = !detailSummarySortAsc;
    } else {
        detailSummarySortCol = colName;
        detailSummarySortAsc = (colName === 'nama' || colName === 'instansi_induk');
    }
    renderDetailSummaryTable();
}

export function renderDetailSummaryTable() {
    currentDetailSummaryDataList.sort((a, b) => {
        let valA = a[detailSummarySortCol] || '';
        let valB = b[detailSummarySortCol] || '';
        if (typeof valA === 'string') return detailSummarySortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return detailSummarySortAsc ? valA - valB : valB - valA;
    });

    const tbody = document.getElementById('summaryTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (currentDetailSummaryDataList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding:15px; color:#7f8c8d;">Tidak ada rincian data usulan.</td></tr>';
        return;
    }

    currentDetailSummaryDataList.forEach((data, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;">${idx + 1}</td>
            <td><strong>${normalizeValue(data.nama)}</strong></td>
            <td>${normalizeValue(data.nip)}</td>
            <td>${cleanInstansiName(data.instansi_induk)}</td>
            <td>${normalizeValue(data.periode_kp || data.periode)}</td>
            <td>${formatTanggal(data.tgl_pengiriman_kelayanan)}</td>
            <td>${formatJenisKP(data.jenis_kp)}</td>
            <td>${normalizeValue(data.status_usulan)}</td>
            <td style="text-align:center; font-weight:bold;">${normalizeValue(data.kategori_status)}</td>
            <td>${normalizeValue(data.no_pertek)}</td>
        `;
        tbody.appendChild(tr);
    });
}

export function getExportHeaderDateText(dataToProcess) {
    try {
        const elPeriode = document.getElementById('dashFilterPeriodeKP')?.value;
        const dateFrom = document.getElementById('dashDateFrom')?.value;
        const dateTo = document.getElementById('dashDateTo')?.value;

        const months = [
            "Januari", "Februari", "Maret", "April", "Mei", "Juni", 
            "Juli", "Agustus", "September", "Oktober", "November", "Desember"
        ];

        const formatTgl = (str) => {
            if (!str || str === '--') return '';
            const parts = str.split('-');
            if (parts.length !== 3) return str;
            const [y, m, d] = parts;
            return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1] || ''} ${y}`;
        };

        const wrapDateColor = (text) => `<span class="rekap-header-date-span">(${text})</span>`;

        if (dateFrom && dateTo) {
            if (dateFrom === dateTo) return wrapDateColor(`Per ${formatTgl(dateFrom)}`);
            return wrapDateColor(`Periode ${formatTgl(dateFrom)} s.d. ${formatTgl(dateTo)}`);
        }
        if (dateFrom) return wrapDateColor(`Mulai ${formatTgl(dateFrom)}`);
        if (dateTo) return wrapDateColor(`Sampai ${formatTgl(dateTo)}`);
        if (elPeriode) return wrapDateColor(`Periode ${elPeriode}`);

        return '';
    } catch (e) {
        return '';
    }
}

export function toggleRekapRegionSection(sectionId) {
    const targetSection = document.getElementById(sectionId); 
    if (!targetSection) return;
    
    const isCurrentlyOpen = targetSection.classList.contains('is-open');
    document.querySelectorAll('.rekap-region-expandable').forEach(sec => sec.classList.remove('is-open'));

    if (!isCurrentlyOpen) {
        renderAllRegionalTables(state.currentDashboardFilteredData || state.combinedDataList.filter(i => isEligibleForApp(i)));
        targetSection.classList.add('is-open');
        setTimeout(() => targetSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 150);
    }
}

export function renderAllRegionalTables(targetDataList) {
    const dataToProcess = Array.isArray(state.currentDashboardFilteredData) && state.currentDashboardFilteredData.length > 0
        ? state.currentDashboardFilteredData
        : (state.combinedDataList ? state.combinedDataList.filter(i => isEligibleForApp(i)) : []);
    
    const dateTextHtml = getExportHeaderDateText(dataToProcess);

    ['exportDateTextPB', 'exportDateTextPBD', 'exportDateTextVert'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = dateTextHtml; 
    });

    const instansiStatsMap = {};
    dataToProcess.forEach(item => {
        const fullInst = item.instansi_induk;
        if (!fullInst || fullInst === '--') return;
        
        const cleanName = cleanInstansiName(fullInst);
        if (!instansiStatsMap[cleanName]) {
            instansiStatsMap[cleanName] = { inbox: 0, bts: 0, tms: 0, sudahTtd: 0, menungguTtd: 0 };
        }

        const statusUsulanRaw = String(item.status_usulan || '').trim();
        const statusLower = statusUsulanRaw.toLowerCase();
        const katStatus = categoriseStatus(statusUsulanRaw);

        if (katStatus === 'Inbox') {
            instansiStatsMap[cleanName].inbox++;
        } else if (katStatus === 'BTS') {
            instansiStatsMap[cleanName].bts++;
        } else if (katStatus === 'TMS') {
            instansiStatsMap[cleanName].tms++;
        } else if (katStatus === 'MS') {
            if (statusLower.includes('menunggu ttd pertek') || statusLower === 'menunggu ttd') {
                instansiStatsMap[cleanName].menungguTtd++;
            } else {
                instansiStatsMap[cleanName].sudahTtd++;
            }
        }
    });

    function populateRegionTable(tbodyId, tfootId, instansiList) {
        const tbody = document.getElementById(tbodyId);
        const tfoot = document.getElementById(tfootId);
        
        if (!tbody) return;
        tbody.innerHTML = '';
        if (tfoot) tfoot.innerHTML = '';

        let sumBerkasMasuk = 0, sumInbox = 0, sumTotalValidasi = 0, sumMs = 0, sumBts = 0, sumTms = 0, sumMenungguTtd = 0, sumSudahTtd = 0;

        instansiList.forEach((instName, idx) => {
            const stats = instansiStatsMap[cleanInstansiName(instName)] || { inbox: 0, bts: 0, tms: 0, sudahTtd: 0, menungguTtd: 0 };
            
            const ms = stats.sudahTtd + stats.menungguTtd;
            const totalValidasi = ms + stats.bts + stats.tms;
            const berkasMasuk = stats.inbox + totalValidasi;

            sumBerkasMasuk += berkasMasuk;
            sumInbox += stats.inbox;
            sumTotalValidasi += totalValidasi;
            sumMs += ms;
            sumBts += stats.bts;
            sumTms += stats.tms;
            sumMenungguTtd += stats.menungguTtd;
            sumSudahTtd += stats.sudahTtd;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="text-align: center;">${idx + 1}</td>
                <td style="text-align: left; padding-left: 6px;"><strong>${instName}</strong></td>
                <td style="text-align: center; font-weight: 800; color: #0f172a;">${berkasMasuk}</td>
                <td style="text-align: center; color: #2563eb; font-weight: bold;">${stats.inbox}</td>
                <td style="text-align: center; font-weight: 800; color: #0f172a;">${totalValidasi}</td>
                <td style="text-align: center; color: #16a34a; font-weight: 800;">${ms}</td>
                <td style="text-align: center; color: #d97706; font-weight: 800;">${stats.bts}</td>
                <td style="text-align: center; color: #dc2626; font-weight: 800;">${stats.tms}</td>
                <td style="text-align: center;">${stats.menungguTtd}</td>
                <td style="text-align: center; color: #0284c7; font-weight: 800;">${stats.sudahTtd}</td>
            `;
            tbody.appendChild(tr);
        });

        if (tfoot) {
            tfoot.innerHTML = `
                <tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #cbd5e1;">
                    <td colspan="2" style="text-align: right !important; padding-right: 10px; color: #0f172a;">TOTAL KESELURUHAN:</td>
                    <td style="text-align: center !important; color: #0f172a;">${sumBerkasMasuk}</td>
                    <td style="text-align: center !important; color: #2563eb;">${sumInbox}</td>
                    <td style="text-align: center !important; color: #0f172a;">${sumTotalValidasi}</td>
                    <td style="text-align: center !important; color: #16a34a;">${sumMs}</td>
                    <td style="text-align: center !important; color: #d97706;">${sumBts}</td>
                    <td style="text-align: center !important; color: #dc2626;">${sumTms}</td>
                    <td style="text-align: center !important;">${sumMenungguTtd}</td>
                    <td style="text-align: center !important; color: #0284c7;">${sumSudahTtd}</td>
                </tr>
            `;
        }
    }

    populateRegionTable('tbody-papua-barat', 'tfoot-papua-barat', REGION_PAPUA_BARAT);
    populateRegionTable('tbody-papua-barat-daya', 'tfoot-papua-barat-daya', REGION_PAPUA_BARAT_DAYA);
    populateRegionTable('tbody-instansi-vertikal', 'tfoot-instansi-vertikal', REGION_INSTANSI_VERTIKAL);
}

export function copyAnyTable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) {
        alert("⚠️ Tabel tidak ditemukan.");
        return;
    }

    const clonedTable = table.cloneNode(true);

    clonedTable.querySelectorAll('tbody tr td').forEach(cell => {
        let text = cell.innerText.replace(/\r?\n|\r/g, " ").trim();
        const cleanDigits = text.replace(/\s+/g, '');
        if (/^\d{18}$/.test(cleanDigits)) {
            cell.innerText = `'${cleanDigits}`;
        }
    });

    const htmlString = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; }
                th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: center; }
                th { background-color: #0f172a; color: #ffffff; font-weight: bold; }
                tfoot tr { background-color: #f8fafc; font-weight: bold; }
            </style>
        </head>
        <body>
            ${clonedTable.outerHTML}
        </body>
        </html>
    `;

    let plainTextRows = [];
    clonedTable.querySelectorAll('tr').forEach(tr => {
        let rowCols = [];
        tr.querySelectorAll('th, td').forEach(cell => {
            rowCols.push(cell.innerText.replace(/\r?\n|\r/g, " ").trim());
        });
        if (rowCols.length > 0) plainTextRows.push(rowCols.join('\t'));
    });
    const plainTextString = plainTextRows.join('\n');

    if (navigator.clipboard && window.ClipboardItem) {
        const blobHtml = new Blob([htmlString], { type: 'text/html' });
        const blobText = new Blob([plainTextString], { type: 'text/plain' });

        const data = new ClipboardItem({
            'text/html': blobHtml,
            'text/plain': blobText
        });

        navigator.clipboard.write([data]).then(() => {
            alert("✅ Tabel Laporan berhasil disalin! Silakan Paste (Ctrl+V) di Excel.");
        }).catch(err => {
            console.error("Gagal copy HTML clipboard:", err);
            fallbackCopyText(plainTextString);
        });
    } else {
        fallbackCopyText(plainTextString);
    }
}

function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        alert("✅ Tabel Laporan disalin (Text Mode)! Silakan Paste (Ctrl+V) di Excel.");
    } catch (e) {
        alert("⚠️ Gagal menyalin tabel secara otomatis.");
    }
    document.body.removeChild(textarea);
}

export function updateFilterActiveState() {
    const instansiVal = document.getElementById('dashFilterInstansi')?.value || '';
    const periodeVal = document.getElementById('dashFilterPeriodeKP')?.value || '';
    const dateFromVal = document.getElementById('dashDateFrom')?.value || '';
    const dateToVal = document.getElementById('dashDateTo')?.value || '';
    
    const filterBox = document.querySelector('.dashboard-filter-card-pro');
    if (filterBox) {
        if (instansiVal || periodeVal || dateFromVal || dateToVal) {
            filterBox.classList.add('has-active-filter');
        } else {
            filterBox.classList.remove('has-active-filter');
        }
    }
}

// Window attachments for HTML compatibility
if (typeof window !== 'undefined') {
    window.openSummaryTableModal = openSummaryTableModal;
    window.openRekapAngkaModal = openRekapAngkaModal;
    window.openRekapInstansiModal = openRekapInstansiModal;
    window.sortRekapInstansiTable = sortRekapInstansiTable;
    window.openDetailInstansiSummaryModal = openDetailInstansiSummaryModal;
    window.sortDetailSummaryTable = sortDetailSummaryTable;
    window.renderAllRegionalTables = renderAllRegionalTables;
    window.toggleRekapRegionSection = toggleRekapRegionSection;
    window.getExportHeaderDateText = getExportHeaderDateText;
    window.copyAnyTable = copyAnyTable;
    window.copyDetailSummaryTableClean = function() { copyAnyTable('summaryExportTable'); };
    window.copyInstansiTableClean = function() { copyAnyTable('tabelRekapInstansi'); };
    window.updateFilterActiveState = updateFilterActiveState;
}
