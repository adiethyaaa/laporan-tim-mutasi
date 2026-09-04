// ============================================================================
// APP.JS - MODULAR APPLICATION ENTRYPOINT
// ============================================================================
// File ini sekarang bertindak sebagai gerbang utama yang memanggil modul-modul
// terorganisir di dalam folder src/.
//
// Struktur modul:
// - src/config/     : Konstanta wilayah & batas sesi
// - src/services/   : Koneksi Firebase & State Manager
// - src/utils/      : Formatter, Anti-XSS, Parser Excel, Aturan Kanreg 14 & KPO
// - src/modules/    : Fitur KP, PI, PGA, Master Instansi, Dashboard, Laporan PDF
// ============================================================================

import "./src/main.js";
