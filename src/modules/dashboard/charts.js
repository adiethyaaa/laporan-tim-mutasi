import { state } from "../../services/store.js";
import { cleanInstansiName, formatJenisKP } from "../../utils/formatters.js";
import { isEligibleForApp, checkIsKPO } from "../../utils/eligibility.js";

export function initCharts() {
    const canvas = document.getElementById('mainTotalChart'); 
    if (!canvas) return;
    if (state.mainTotalChart) state.mainTotalChart.destroy();
    
    state.mainTotalChart = new Chart(canvas.getContext('2d'), {
        type: 'bar', 
        data: { 
            labels: ['Status'], 
            datasets: [
                { label: 'MS', data: [0], backgroundColor: '#2ecc71' }, 
                { label: 'BTS', data: [0], backgroundColor: '#f1c40f' }, 
                { label: 'TMS', data: [0], backgroundColor: '#e74c3c' }, 
                { label: 'Inbox', data: [0], backgroundColor: '#3498db' }
            ] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { title: { display: true, text: 'Rekapitulasi Usulan KP' } }, 
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } 
        }
    });
}

export function updateDashboardChartsAndCards(filteredData) {
    if (!state.mainTotalChart) initCharts();
    if (!state.mainTotalChart) return;

    let ms = 0, bts = 0, tms = 0, inb = 0, kReg = 0, kIj = 0, kJf = 0, kStr = 0; 
    const rMap = {};
    const sInst = document.getElementById('dashFilterInstansi')?.value;

    filteredData.forEach(i => {
        if (i.instansi_induk && i.instansi_induk !== '--') {
            const k = cleanInstansiName(i.instansi_induk); 
            if (!rMap[k]) rMap[k] = { MS: 0, BTS: 0, TMS: 0, Inbox: 0, Total: 0 };
            
            if (i.kategori_status === 'MS') rMap[k].MS++; 
            else if (i.kategori_status === 'BTS') rMap[k].BTS++; 
            else if (i.kategori_status === 'TMS') rMap[k].TMS++; 
            else rMap[k].Inbox++; 
            rMap[k].Total++;
        }
        
        if (i.kategori_status === 'MS') ms++; 
        else if (i.kategori_status === 'BTS') bts++; 
        else if (i.kategori_status === 'TMS') tms++; 
        else inb++;
        
        const j = formatJenisKP(i.jenis_kp); 
        if (j === "KP Reguler") kReg++; 
        else if (j === "KP Penyesuaian Ijazah") kIj++; 
        else if (j === "KP JF") kJf++; 
        else if (j === "KP Struktural") kStr++;
    });

    state.mainTotalChart.options.plugins.title.text = `Rekap - ${sInst ? cleanInstansiName(sInst) : 'Semua Instansi'}`;
    state.mainTotalChart.data.datasets[0].data = [ms]; 
    state.mainTotalChart.data.datasets[1].data = [bts]; 
    state.mainTotalChart.data.datasets[2].data = [tms]; 
    state.mainTotalChart.data.datasets[3].data = [inb]; 
    state.mainTotalChart.update();
    
    if (document.getElementById('totalSummaryBadge')) document.getElementById('totalSummaryBadge').innerHTML = `Total Usulan: <strong>${ms+bts+tms+inb} Data</strong>`;
    if (document.getElementById('cardMsValue')) document.getElementById('cardMsValue').innerText = ms;
    if (document.getElementById('cardBtsValue')) document.getElementById('cardBtsValue').innerText = bts;
    if (document.getElementById('cardTmsValue')) document.getElementById('cardTmsValue').innerText = tms;
    if (document.getElementById('cardInboxValue')) document.getElementById('cardInboxValue').innerText = inb;
    
    if (document.getElementById('miniKpReguler')) document.getElementById('miniKpReguler').innerText = kReg;
    if (document.getElementById('miniKpIjazah')) document.getElementById('miniKpIjazah').innerText = kIj;
    if (document.getElementById('miniKpJf')) document.getElementById('miniKpJf').innerText = kJf;
    if (document.getElementById('miniKpStruktural')) document.getElementById('miniKpStruktural').innerText = kStr;
    
    const g = document.getElementById('donutCardsGrid'); 
    if (!g) return; 
    g.innerHTML = '';
    
    Object.keys(state.donutChartInstancesMap).forEach(k => state.donutChartInstancesMap[k]?.destroy()); 
    state.donutChartInstancesMap = {};
    
    const kKeys = Object.keys(rMap).sort(); 
    if (kKeys.length === 0) { 
        g.innerHTML = '<p style="grid-column: 1/-1; text-align: center;">Belum ada data.</p>'; 
        return; 
    }
    
    kKeys.forEach((k, idx) => {
        const id = `donut_${idx}`;
        const d = document.createElement('div'); 
        d.className = 'donut-card-box';
        d.innerHTML = `<div class="donut-card-title">${k}</div><div class="donut-card-badge">Total: ${rMap[k].Total}</div><div class="donut-canvas-wrapper"><canvas id="${id}"></canvas></div>`;
        g.appendChild(d);
        
        state.donutChartInstancesMap[id] = new Chart(document.getElementById(id).getContext('2d'), { 
            type: 'doughnut', 
            data: { 
                labels: [`MS`, `BTS`, `TMS`, `Inbox`], 
                datasets: [{ 
                    data: [rMap[k].MS, rMap[k].BTS, rMap[k].TMS, rMap[k].Inbox], 
                    backgroundColor: ['#2ecc71', '#f1c40f', '#e74c3c', '#3498db'] 
                }] 
            }, 
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } 
            } 
        });
    });
}

export function updateDashboardMetrics() {
    const elPeriodeKP = document.getElementById('dashFilterPeriodeKP');
    const elInstansi = document.getElementById('dashFilterInstansi');
    const elDateFrom = document.getElementById('dashDateFrom');
    const elDateTo = document.getElementById('dashDateTo');
    
    const elToggleKPO = document.getElementById('toggleIncludeKPO');
    const includeKPO = elToggleKPO ? elToggleKPO.checked : true;
    state.includeKPO = includeKPO;
    window.includeKPO = includeKPO;

    const selectedPeriodeKP = elPeriodeKP ? elPeriodeKP.value.trim().toUpperCase() : '';
    const selectedFilterInstansi = elInstansi ? elInstansi.value.trim() : '';
    const dateFromVal = elDateFrom ? elDateFrom.value : '';
    const dateToVal = elDateTo ? elDateTo.value : '';

    state.currentDashboardFilteredData = state.combinedDataList.filter(item => {
        if (!isEligibleForApp(item)) return false;
        
        if (!includeKPO && checkIsKPO(item)) {
            return false;
        }
        
        if (selectedPeriodeKP !== '') {
            const periodeItem = String(item.periode_kp || item.periode || '').trim().toUpperCase();
            if (!periodeItem.includes(selectedPeriodeKP)) return false;
        }

        if (selectedFilterInstansi !== '' && item.instansi_induk !== selectedFilterInstansi) return false;

        const tglStr = item.tgl_pengiriman_kelayanan;
        if (tglStr && tglStr !== '--') {
            if (dateFromVal !== '' && tglStr < dateFromVal) return false;
            if (dateToVal !== '' && tglStr > dateToVal) return false;
        }
        return true;
    });

    window.currentDashboardFilteredData = state.currentDashboardFilteredData;

    updateDashboardChartsAndCards(state.currentDashboardFilteredData);
    if (typeof window.renderAllRegionalTables === 'function') {
        window.renderAllRegionalTables(state.currentDashboardFilteredData);
    }
    
    renderDailyTrendChart(state.currentDashboardFilteredData);
}

export function resetDashboardFilters(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    
    ['dashFilterInstansi', 'dashFilterPeriodeKP', 'dashDateFrom', 'dashDateTo'].forEach(id => {
        if (document.getElementById(id)) document.getElementById(id).value = '';
    });
    
    const elToggleKPO = document.getElementById('toggleIncludeKPO');
    if (elToggleKPO) elToggleKPO.checked = true;
    state.includeKPO = true;
    window.includeKPO = true;
    
    if (typeof window.updateFilterActiveState === 'function') {
        window.updateFilterActiveState();
    }
    updateDashboardMetrics();
}

export function renderDailyTrendChart(activeDataList) {
    const ctx = document.getElementById('dailyTrendChart');
    if (!ctx) return;

    const dateCounts = {};
    activeDataList.forEach(item => {
        const rawDate = item.tgl_pengiriman_kelayanan;
        if (rawDate && rawDate !== '--') {
            dateCounts[rawDate] = (dateCounts[rawDate] || 0) + 1;
        }
    });

    const sortedDates = Object.keys(dateCounts).sort();
    const NAMA_BULAN_SINGKAT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    
    const labels = sortedDates.map(dateStr => {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const y = parts[0], m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
            return `${d} ${NAMA_BULAN_SINGKAT[m]} ${y}`;
        }
        return dateStr;
    });
    
    const dataPoints = sortedDates.map(date => dateCounts[date]);

    const chartDateEl = document.getElementById('trendChartDateText');
    if (chartDateEl && typeof window.getExportHeaderDateText === 'function') {
        chartDateEl.innerHTML = window.getExportHeaderDateText(activeDataList);
    }

    if (state.dailyTrendChartInstance) {
        state.dailyTrendChartInstance.destroy();
    }

    state.dailyTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Jumlah Usulan',
                data: dataPoints,
                borderColor: '#0284c7',          
                backgroundColor: 'rgba(2, 132, 199, 0.1)', 
                borderWidth: 2.5,
                pointBackgroundColor: '#ffffff', 
                pointBorderColor: '#0284c7',     
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.3                     
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }, 
                tooltip: {
                    backgroundColor: '#0f172a', padding: 10,
                    callbacks: { label: function(context) { return ` ${context.parsed.y} Berkas Usulan`; } }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 }, 
                    grid: { color: '#e2e8f0', borderDash: [5, 5] } 
                },
                x: {
                    grid: { display: false } 
                }
            }
        }
    });
}

// Pasang ke window agar backward-compatible
if (typeof window !== 'undefined') {
    window.initCharts = initCharts;
    window.updateDashboardChartsAndCards = updateDashboardChartsAndCards;
    window.updateDashboardMetrics = updateDashboardMetrics;
    window.resetDashboardFilters = resetDashboardFilters;
    window.renderDailyTrendChart = renderDailyTrendChart;
}
