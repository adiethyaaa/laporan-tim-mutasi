import { state } from "../../services/store.js";
import { NAMA_BULAN } from "../../config/constants.js";
import { calculatePeriodeKP, standardizeInstansiName } from "../../utils/formatters.js";
import { isEligibleForApp } from "../../utils/eligibility.js";
import { getExportHeaderDateText } from "../dashboard/rekapModals.js";

export function previewLaporanPDF(customHeaderBg = '#0d1220', customHeaderColor = '#ffffff') {
    const btn = window.event ? window.event.currentTarget : null;
    const originalText = btn ? btn.innerHTML : '';
    const tbodyPB = document.getElementById('tbody-papua-barat');
    const tfootPB = document.getElementById('tfoot-papua-barat');
    const tbodyPBD = document.getElementById('tbody-papua-barat-daya');
    const tfootPBD = document.getElementById('tfoot-papua-barat-daya');
    const tbodyVert = document.getElementById('tbody-instansi-vertikal');
    const tfootVert = document.getElementById('tfoot-instansi-vertikal');

    if ((!tbodyPB || tbodyPB.children.length === 0) && (!tbodyPBD || tbodyPBD.children.length === 0) && (!tbodyVert || tbodyVert.children.length === 0)) { 
        alert("⚠️ Data tabel rekapitulasi masih kosong."); 
        return; 
    }

    if (btn) { 
        btn.innerHTML = `<span class="spinner-pdf" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Memproses PDF...`; 
        btn.disabled = true; 
    }

    const overlay = document.createElement('div'); 
    overlay.className = 'pdf-loading-overlay';
    overlay.innerHTML = `<div class="pdf-spinner"></div><div style="font-weight: 700; font-size: 15px;">Menyiapkan Dokumen PDF Laporan KP...</div><div style="font-size: 12px; color: #94a3b8; margin-top: 5px;">Mohon tunggu sebentar, membuka preview di tab baru...</div>`;
    document.body.appendChild(overlay);

    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const witDate = new Date(utc + (3600000 * 9));
    const day = String(witDate.getDate()).padStart(2, '0');
    const month = NAMA_BULAN[witDate.getMonth()];
    const year = witDate.getFullYear();
    const hours = String(witDate.getHours()).padStart(2, '0');
    const minutes = String(witDate.getMinutes()).padStart(2, '0');
    const headerTglStr = `DATA PER ${day} ${month.toUpperCase()} ${year} PUKUL ${hours}.${minutes} WIT`;

    const activeDataList = Array.isArray(state.currentDashboardFilteredData) && state.currentDashboardFilteredData.length > 0
        ? state.currentDashboardFilteredData
        : (state.combinedDataList ? state.combinedDataList.filter(i => isEligibleForApp(i)) : []);

    let subJudulDateStr = "";
    if (typeof getExportHeaderDateText === 'function') {
        const rawDateText = getExportHeaderDateText(activeDataList);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = rawDateText;
        subJudulDateStr = tempDiv.textContent || tempDiv.innerText || "";
    }

    const generatePageHtml = (namaWilayah, tbodyEl, tfootEl) => {
        const tbodyContent = tbodyEl ? tbodyEl.innerHTML : '<tr><td colspan="10" style="text-align:center;">Data tidak tersedia</td></tr>';
        const tfootContent = (tfootEl && tfootEl.innerHTML.trim() !== '') ? `<tfoot class="tfoot-total-double">${tfootEl.innerHTML}</tfoot>` : '';
        
        return `
            <div class="pdf-page">
                <div class="header-container">
                    <div class="header-title">LAPORAN PROGRES USULAN KENAIKAN PANGKAT</div>
                    <div class="header-title">WILAYAH KERJA KANTOR REGIONAL XIV BKN MANOKWARI</div>
                    <div class="header-subtitle-range"></div>
                    <div class="header-subtitle">${subJudulDateStr}</div>
                    <div class="header-date"><br>${headerTglStr}</div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th style="width: 4%;">No</th>
                            <th style="width: 28%; text-align: left; padding-left: 5px;">Instansi</th>
                            <th style="width: 8.5%;">Berkas Masuk</th>
                            <th style="width: 8.5%;">Approval Usulan (Inbox)</th>
                            <th style="width: 8.5%;">Total Validasi</th>
                            <th style="width: 8.5%; color: #86efac;">MS</th>
                            <th style="width: 8.5%; color: #fde047;">BTS</th>
                            <th style="width: 8.5%; color: #fca5a5;">TMS</th>
                            <th style="width: 8.5%;">Menunggu TTD Pertek</th>
                            <th style="width: 8.5%; color: #7dd3fc;">Sudah TTD Pertek</th>
                        </tr>
                    </thead>
                    <tbody>${tbodyContent}</tbody>
                    ${tfootContent}
                </table>

                <div class="signature-box">
                    <div class="signature-content">
                        <p style="margin: 0 0 45px 0;">
                            Manokwari, ${day} ${month} ${year}<br>
                            <br><strong>Tim Pengangkatan dan Mutasi</strong>
                        </p>
                        <p style="margin: 0; font-weight: bold; text-decoration: underline;"></p>
                    </div>
                </div>
            </div>
        `;
    };

    setTimeout(() => {
        const printWindow = window.open('', '_blank');
        if (!printWindow) { 
            alert("⚠️ Pop-up diblokir oleh browser."); 
            if (document.body.contains(overlay)) document.body.removeChild(overlay); 
            if (btn) { btn.innerHTML = originalText; btn.disabled = false; } 
            return; 
        }
        
        const page1Html = generatePageHtml("PROVINSI PAPUA BARAT", tbodyPB, tfootPB);
        const page2Html = generatePageHtml("PROVINSI PAPUA BARAT DAYA", tbodyPBD, tfootPBD);
        const page3Html = generatePageHtml("INSTANSI VERTIKAL", tbodyVert, tfootVert);

        printWindow.document.write(`<!DOCTYPE html><html><head><title>Laporan KP Updated per ${day}-${month}-${year} ${hours}.${minutes} WIT</title><style>@page { size: A4 landscape; margin: 8mm; } body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; } .pdf-page { padding: 5px 8px; page-break-after: always; break-after: page; box-sizing: border-box; } .pdf-page:last-child { page-break-after: auto; break-after: auto; } .header-container { text-align: center; margin-bottom: 10px; border-bottom: 2px solid #000; padding-bottom: 6px; } .header-title { margin: 0 0 2px 0; font-size: 11pt; font-weight: 800; text-transform: uppercase; } .header-subtitle-range { margin: 0 0 4px 0; font-size: 8.5pt; font-weight: 700; color: #000; } .header-subtitle { margin: 0 0 2px 0; font-size: 9pt; font-weight: 700; text-transform: uppercase; } .header-date { margin: 0; font-size: 7.5pt; font-weight: 700; color: #333; } table { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-top: 6px; } th, td { border: 1px solid #000 !important; padding: 4px 2px; text-align: center; word-wrap: break-word; } th { background-color: ${customHeaderBg} !important; color: ${customHeaderColor} !important; font-weight: bold; font-size: 7.5pt; } td.instansi-cell { text-align: left !important; padding-left: 5px; } tfoot.tfoot-total-double tr td { background-color: #f8fafc !important; font-weight: bold !important; border-top: 3px double #000 !important; border-bottom: 2px solid #000 !important; color: #000 !important; } .signature-box { margin-top: 20px; display: flex; justify-content: flex-end; } .signature-content { text-align: center; font-size: 8pt; }</style></head><body>${page1Html}${page2Html}${page3Html}</body></html>`);
        printWindow.document.close();
        printWindow.document.querySelectorAll('tbody tr').forEach(r => { 
            const tdInst = r.children[1]; 
            if (tdInst) tdInst.className = 'instansi-cell'; 
        });
        
        if (document.body.contains(overlay)) document.body.removeChild(overlay); 
        if (btn) { btn.innerHTML = originalText; btn.disabled = false; }
        printWindow.focus(); 
        printWindow.print();
    }, 1500);
}

export function exportLaporanPIPDF() {
    const dataList = (typeof state.combinedDataList !== 'undefined' && state.currentModule === 'PI')
        ? state.combinedDataList
        : Object.keys(state.dbFetchedMap || {}).map(k => ({ dbKey: k, ...state.dbFetchedMap[k] }));

    if (!dataList || dataList.length === 0) {
        alert("⚠️ Tidak ada data Pindah Instansi (PI) di database untuk di-export.");
        return;
    }

    const validDates = dataList
        .map(i => i.tgl_validasi || (i.uploaded_at ? String(i.uploaded_at).substring(0, 10) : ''))
        .filter(d => d && d !== '--')
        .sort();

    const formatDateIndo = (strDate) => {
        if (!strDate) return '--';
        const parts = strDate.split('-');
        if (parts.length !== 3) return strDate;
        const [y, m, d] = parts;
        return `${parseInt(d, 10)} ${NAMA_BULAN[parseInt(m, 10) - 1]} ${y}`;
    };

    const dateRangeText = validDates.length > 0
        ? `${formatDateIndo(validDates[0])} s/d ${formatDateIndo(validDates[validDates.length - 1])}`
        : 'Semua Data';

    const REGIONS = ['Papua Barat', 'Papua Barat Daya'];
    const groupedData = {
        'Papua Barat': {},
        'Papua Barat Daya': {},
        'Instansi Vertikal': {}
    };

    dataList.forEach(item => {
        const instAsal = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(item.instansi_asal) : (item.instansi_asal || '');
        const instTujuan = (typeof standardizeInstansiName === 'function') ? standardizeInstansiName(item.instansi_tujuan) : (item.instansi_tujuan || '-');
        
        let wilker = (typeof window.getAutomaticWilker === 'function')
            ? window.getAutomaticWilker(instAsal, instTujuan)
            : (item.wilker_prov || 'Instansi Vertikal');

        if (!REGIONS.includes(wilker)) wilker = 'Instansi Vertikal';

        if (!groupedData[wilker][instTujuan]) {
            groupedData[wilker][instTujuan] = { MS: 0, BTS: 0, TMS: 0 };
        }

        const st = String(item.status || '').toUpperCase().trim();
        if (st === 'MS' || st === 'ACC') {
            groupedData[wilker][instTujuan].MS++;
        } else if (st === 'BTS') {
            groupedData[wilker][instTujuan].BTS++;
        } else if (st === 'TMS') {
            groupedData[wilker][instTujuan].TMS++;
        }
    });

    let tablesHtml = '';

    REGIONS.forEach((regionName, regIdx) => {
        const instansiMap = groupedData[regionName];
        const sortedInstansi = Object.keys(instansiMap).sort((a, b) => a.localeCompare(b));

        let rowsHtml = '';
        let sumMS = 0, sumBTS = 0, sumTMS = 0;

        if (sortedInstansi.length === 0) {
            rowsHtml = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 10px;">Tidak ada data usulan untuk wilayah ini.</td></tr>`;
        } else {
            sortedInstansi.forEach((instName, idx) => {
                const counts = instansiMap[instName];
                const totalBaris = counts.MS + counts.BTS + counts.TMS;
                sumMS += counts.MS;
                sumBTS += counts.BTS;
                sumTMS += counts.TMS;

                rowsHtml += `
                    <tr>
                        <td style="text-align: center; width: 6%;">${idx + 1}</td>
                        <td style="text-align: left; padding-left: 8px;"><strong>${instName}</strong></td>
                        <td style="text-align: center; color: #16a34a; font-weight: bold; width: 14%;">${counts.MS}</td>
                        <td style="text-align: center; color: #d97706; font-weight: bold; width: 14%;">${counts.BTS}</td>
                        <td style="text-align: center; color: #dc2626; font-weight: bold; width: 14%;">${counts.TMS}</td>
                        <td style="text-align: center; font-weight: bold; width: 14%; background-color: #f8fafc;">${totalBaris}</td>
                    </tr>
                `;
            });
        }

        const totalWilayah = sumMS + sumBTS + sumTMS;

        tablesHtml += `
            <div class="table-section" style="${regIdx > 0 ? 'margin-top: 25px;' : ''}">
                <div style="font-size: 10pt; font-weight: bold; background: #0f172a; color: #ffffff; padding: 6px 10px; border-radius: 4px 4px 0 0; display: flex; justify-content: space-between;">
                    <span>TABEL ${regIdx + 1}: WILAYAH ${regionName.toUpperCase()}</span>
                    <span>TOTAL: ${totalWilayah} USULAN</span>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>NO</th>
                            <th style="text-align: left; padding-left: 8px;">INSTANSI TUJUAN</th>
                            <th style="color: #86efac;">MS</th>
                            <th style="color: #fde047;">BTS</th>
                            <th style="color: #fca5a5;">TMS</th>
                            <th>TOTAL</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                    <tfoot>
                        <tr style="background: #e2e8f0; font-weight: bold;">
                            <td colspan="2" style="text-align: right; padding-right: 10px;">TOTAL WILAYAH ${regionName.toUpperCase()}:</td>
                            <td style="text-align: center; color: #16a34a;">${sumMS}</td>
                            <td style="text-align: center; color: #d97706;">${sumBTS}</td>
                            <td style="text-align: center; color: #dc2626;">${sumTMS}</td>
                            <td style="text-align: center; font-size: 9pt;">${totalWilayah}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    });

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("⚠️ Pop-up diblokir oleh browser. Izinkan pop-up untuk mencetak PDF.");
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Laporan Rekapitulasi PI - 3 Wilayah</title>
            <style>
                @page { size: A4 portrait; margin: 10mm; }
                body { font-family: Arial, sans-serif; font-size: 8.5pt; color: #000; margin: 0; padding: 0; }
                .header-container { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
                .header-title { font-size: 11pt; font-weight: bold; text-transform: uppercase; }
                .header-subtitle { font-size: 9pt; font-weight: bold; color: #0284c7; margin-top: 4px; }
                .header-date-range { font-size: 8pt; font-weight: bold; color: #334155; margin-top: 4px; background: #f1f5f9; display: inline-block; padding: 3px 10px; border-radius: 4px; border: 1px solid #cbd5e1; }
                .table-section { page-break-inside: avoid; }
                table { width: 100%; border-collapse: collapse; margin-top: 0; }
                th, td { border: 1px solid #cbd5e1; padding: 5px; text-align: center; }
                th { background-color: #1e293b; color: #ffffff; font-weight: bold; font-size: 8pt; }
            </style>
        </head>
        <body>
            <div class="header-container">
                <div class="header-title">LAPORAN REKAPITULASI PINDAH INSTANSI (PI)</div>
                <div class="header-subtitle">KANTOR REGIONAL XIV BKN MANOKWARI</div>
                <div class="header-date-range">🗓️ RENTANG TANGGAL DATA: ${dateRangeText.toUpperCase()}</div>
            </div>
            ${tablesHtml}
        </body>
        </html>
    `);

    printWindow.document.close();
    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 500);
}

if (typeof window !== 'undefined') {
    window.previewLaporanPDF = previewLaporanPDF;
    window.exportLaporanPIPDF = exportLaporanPIPDF;
}
