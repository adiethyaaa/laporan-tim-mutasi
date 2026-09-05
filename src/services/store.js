export const state = {
    dbFetchedMap: {},
    combinedDataList: [],
    selectedFilesQueue: [],
    selectedFilesQueuePI: [],
    selectedFilesQueuePGA: [],
    mainTotalChart: null,
    donutChartInstancesMap: {},
    dailyTrendChartInstance: null,
    isFirstDbLoad: true,
    previousDbSnapshot: null,
    dbUnsubscribe: null,
    currentSortColumn: 'tgl_pengiriman_kelayanan',
    isAscending: false,
    selectedDbKeys: new Set(),
    currentUserInitial: '--',
    currentUserRole: 'User',
    currentUserAllowDelete: false,
    currentModule: 'KP',
    currentDashboardFilteredData: [],
    includeKPO: true
};

// Mirror ke window agar inline HTML onclick tetap sinkron
if (typeof window !== 'undefined') {
    window.appState = state;
    window.currentDashboardFilteredData = state.currentDashboardFilteredData;
    window.includeKPO = state.includeKPO;
    try {
        Object.defineProperty(window, 'currentModule', {
            get() { return state.currentModule; },
            set(val) { state.currentModule = val; },
            configurable: true
        });
    } catch (e) {
        window.currentModule = state.currentModule;
    }
}
