export function isGolonganIVc(val) {
    if (!val || val === '--') return false;
    const str = String(val).toLowerCase();
    return str.includes('iv/c') || 
           str.includes('iv c') || 
           str.includes('iv.c') || 
           /\bivc\b/.test(str);
}

export function isEligibleForApp(item) {
    if (!item) return false;

    const golBaru = item.gol_tmt_baru || item.golongan_ruang || '';
    const golLama = item.gol_tmt_lama || '';
    if (isGolonganIVc(golBaru) || isGolonganIVc(golLama)) {
        return false;
    }

    const kanreg = String(item.kanreg_operator ?? '').trim();
    const statusKpoStr = String(item.status_kpo ?? '').trim().toLowerCase();
    const isKpo = (statusKpoStr === 'true' || statusKpoStr === '1' || statusKpoStr === 'ya');
    
    const isKanregNol = (kanreg === '0' || kanreg === '00' || parseInt(kanreg, 10) === 0);
    
    return (kanreg === '14') || (isKanregNol && isKpo);
}

export function checkIsKPO(item) {
    const kanreg = String(item.kanreg_operator ?? '').trim();
    const statusKpoStr = String(item.status_kpo ?? '').trim().toLowerCase();
    
    const isKanregNol = (kanreg === '0' || kanreg === '00' || parseInt(kanreg, 10) === 0);
    const isKpo = (statusKpoStr === 'true' || statusKpoStr === '1' || statusKpoStr === 'ya');
    
    return (isKanregNol && isKpo);
}

// Pasang ke window agar backward-compatible
if (typeof window !== 'undefined') {
    window.isGolonganIVc = isGolonganIVc;
    window.isEligibleForApp = isEligibleForApp;
    window.checkIsKPO = checkIsKPO;
}
