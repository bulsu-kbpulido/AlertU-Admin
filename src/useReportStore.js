import { create } from 'zustand';

export const useReportStore = create((set) => ({
  // Modal & Step State
  isVerifyModalOpen: false,
  currentStep: 1,
  
  // Active Selected Report
  selectedReport: null,
  
  // Verification Form Fields
  customLocation: { lat: null, lng: null, address: '' },
  verifiedIncidentType: '',
  verifiedSeverity: 'Medium',
  adminNotes: '',
  isSensitive: false,
  reportTitle: '',
  selectedAgencies: [],
  tempSpatialData: {},

  // Actions
  setVerifyModalOpen: (isOpen) => set({ isVerifyModalOpen: isOpen }),
  setCurrentStep: (step) => set({ currentStep: step }),
  setSelectedReport: (report) => set({ selectedReport: report }),
  setCustomLocation: (location) => set((state) => ({ 
    customLocation: typeof location === 'function' ? location(state.customLocation) : location 
  })),
  setVerifiedIncidentType: (type) => set({ verifiedIncidentType: type }),
  setVerifiedSeverity: (severity) => set({ verifiedSeverity: severity }),
  setAdminNotes: (notes) => set({ adminNotes: notes }),
  setIsSensitive: (isSens) => set({ isSensitive: isSens }),
  setReportTitle: (title) => set({ reportTitle: title }),
  setSelectedAgencies: (agencies) => set((state) => ({
    selectedAgencies: typeof agencies === 'function' ? agencies(state.selectedAgencies) : agencies
  })),
  setTempSpatialData: (data) => set({ tempSpatialData: data }),

  // Full Form Reset Helper
  resetModalState: () => set({
    currentStep: 1,
    selectedReport: null,
    reportTitle: '',
    selectedAgencies: [],
    tempSpatialData: {},
    isSensitive: false,
    adminNotes: '',
    customLocation: { lat: null, lng: null, address: '' },
    isVerifyModalOpen: false,
  }),
}));