import { NAMA_BULAN } from "../config/constants.js";

export function normalizeValue(val) { 
    if (val === null || val === undefined) return '--'; 
    let str = String(val).trim(); 
    if (str === '' || str === '-' || str === '<nil>') return '--'; 
    
    // Mencegah XSS Attack
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function formatDateTime(isoString) { 
    if (!isoString || isoString === '--') return 'Waktu simpan tidak tercatat'; 
    const d = new Date(isoString); 
    if (isNaN(d.getTime())) return isoString; 
    
    return `${String(d.getDate()).padStart(2, '0')} ${NAMA_BULAN[d.getMonth()]} ${d.getFullYear()}, Pukul ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} WIT`; 
}

export function categoriseStatus(status) {
    if (!status || status === '--') return 'Inbox';
    const c = String(status).trim().toLowerCase();

    if (c.includes('approval') || c.includes('approval surat usulan') || c.includes('approval usulan') || c.includes('inbox') || c.includes('usulan masuk') || c.includes('draft')) {
        return 'Inbox';
    }
    if (c.includes('tms') || c.includes('tidak memenuhi')) {
        return 'TMS';
    }
    if (c.includes('bts') || c.includes('perbaikan') || c.includes('berkas tidak sesuai') || c.includes('dokumen')) {
        return 'BTS';
    }
    if (c.includes('setuju') || c.includes('ttd sk') || c.includes('ttd pertek') || c.includes('sdh di ttd') || c.includes('sudah di ttd') || c.includes('pembuatan sk berhasil') || c.includes('sk berhasil') || c.includes('ms') || c.includes('acc')) {
        return 'MS';
    }
    return 'Inbox';
}

export function formatJenisKP(jenisKP) { 
    const text = normalizeValue(jenisKP); 
    if (text === '--') return '--'; 
    if (text.includes("Memperoleh Ijazah") || text.includes("Penyesuaian Ijazah")) return "KP Penyesuaian Ijazah"; 
    if (text.includes("Reguler")) return "KP Reguler"; 
    if (text.includes("Jabatan Fungsional") || text.includes("Fungsional")) return "KP JF"; 
    if (text.includes("Struktural")) return "KP Struktural"; 
    return text; 
}

export function cleanInstansiName(name) { 
    const norm = normalizeValue(name); 
    return norm === '--' ? '--' : norm.replace(/^Pemerintah\s+/i, '').trim(); 
}

export function formatTanggal(excelDate) { 
    if (!excelDate || excelDate === '<nil>') return '--'; 
    if (typeof excelDate === 'number') { 
        const date = new Date((excelDate - 25569) * 86400 * 1000); 
        return date.toISOString().split('T')[0]; 
    } 
    const str = String(excelDate).trim();
    // Jika format DD/MM/YYYY (contoh: 01/09/2025)
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
        const [d, m, y] = str.split('/');
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const sub = str.substring(0, 10); 
    return sub.trim() !== '' ? sub : '--'; 
}

export function formatFileSize(bytes) { 
    if (bytes === 0) return '0 Bytes'; 
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(bytes) / Math.log(k)); 
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]; 
}

export function calculatePeriodeKP(tglUsulMasuk) {
    if (!tglUsulMasuk || tglUsulMasuk === '--') return '--';
    const parts = String(tglUsulMasuk).trim().split('-');
    if (parts.length !== 3) return '--';
    
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10); 
    const day = parseInt(parts[2], 10);

    if (isNaN(year) || isNaN(month) || isNaN(day)) return '--';

    let targetMonthIdx;
    if (day >= 16) {
        targetMonthIdx = (month - 1) + 2; 
    } else {
        targetMonthIdx = (month - 1) + 1;
    }

    let finalYear = year + Math.floor(targetMonthIdx / 12);
    let finalMonthIdx = targetMonthIdx % 12;

    return `${NAMA_BULAN[finalMonthIdx]} ${finalYear}`;
}

export function standardizeInstansiName(name) {
    let norm = normalizeValue(name);
    if (norm === '--') return '--';

    // Hapus awalan "Pemerintah " agar seragam
    norm = norm.replace(/^Pemerintah\s+/i, '').trim();

    const rawLower = norm.toLowerCase();
    
    // 1. Standarisasi Pemda Wilayah Papua Barat Daya
    if (rawLower.includes('maybrat')) return 'Kab. Maybrat';
    if (rawLower.includes('raja ampat')) return 'Kab. Raja Ampat';
    if (rawLower.includes('tambrauw')) return 'Kab. Tambrauw';
    if (rawLower.includes('sorong selatan') || rawLower.includes('sorsel')) return 'Kab. Sorong Selatan';
    if (rawLower.includes('kota sorong')) return 'Kota Sorong';
    if (rawLower === 'kab. sorong' || rawLower === 'kabupaten sorong' || rawLower === 'sorong') return 'Kab. Sorong';
    
    // 2. Standarisasi Pemda Wilayah Papua Barat
    if (rawLower.includes('fak-fak') || rawLower.includes('fakfak')) return 'Kab. Fak-Fak';
    if (rawLower.includes('kaimana')) return 'Kab. Kaimana';
    if (rawLower.includes('teluk wondama') || rawLower.includes('wondama')) return 'Kab. Teluk Wondama';
    if (rawLower.includes('teluk bintuni') || rawLower.includes('bintuni')) return 'Kab. Teluk Bintuni';
    if (rawLower.includes('manokwari selatan') || rawLower.includes('mansel')) return 'Kab. Manokwari Selatan';
    if (rawLower.includes('pegunungan arfak') || rawLower.includes('pegaf')) return 'Kab. Pegunungan Arfak';
    if (rawLower === 'kab. manokwari' || rawLower === 'kabupaten manokwari' || rawLower === 'manokwari') return 'Kab. Manokwari';
    
    // 3. Standarisasi Provinsi
    if (rawLower.includes('papua barat daya') || rawLower.includes('daya')) return 'Prov. Papua Barat Daya';
    if (rawLower.includes('papua barat') || rawLower.includes('pabar')) return 'Prov. Papua Barat';

    // 4. KEMBALIKAN TEKS MURNI
    return norm;
}

export function toTitleCase(str) {
    if (!str) return '';
    return str.toLowerCase().split(' ').map(word => {
        if (!word) return '';
        if (word === 'kab.' || word === 'kabupaten') return 'Kab.';
        if (word === 'prov.' || word === 'provinsi') return 'Provinsi';
        if (word === 'dan') return 'dan';
        if (word === 'atau') return 'atau';
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ');
}

export function toCapitalEachWord(str) { 
    if (!str) return ''; 
    return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '); 
}
