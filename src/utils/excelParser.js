import { normalizeValue } from "./formatters.js";

export function isValidExcelStructure(rows) {
    if (!rows || rows.length < 4) return false;
    let headerMatch = false;
    for (let r = 0; r < Math.min(rows.length, 4); r++) { 
        const rowStr = JSON.stringify(rows[r] || '').toLowerCase(); 
        if (rowStr.includes('instansi') || rowStr.includes('nip') || rowStr.includes('nama')) { 
            headerMatch = true; 
            break; 
        } 
    }
    let validSampleCount = 0;
    for (let i = 3; i < Math.min(rows.length, 15); i++) { 
        const row = rows[i]; 
        if (!row) continue; 
        const instansi = normalizeValue(row[0]), nip = normalizeValue(row[12]); 
        if (instansi !== '--' && nip !== '--' && String(nip).replace(/\D/g, '').length >= 8) validSampleCount++; 
    }
    return headerMatch && (validSampleCount > 0);
}

export function isValidExcelStructurePI(rows) {
    if (!rows || rows.length === 0) return false;
    const header = rows[0].map(cell => String(cell).toUpperCase().trim());
    
    const hasNama = header.some(h => h.includes("NAMA"));
    const hasNip = header.some(h => h.includes("NIP"));
    
    return hasNama && hasNip;
}
