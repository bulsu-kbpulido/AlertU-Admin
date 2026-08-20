import { create } from 'zustand';

export const useCitizenStore = create((set, get) => ({
  // ── Action Tag & Disable Override Tracker ──
  disabledCitizens: {}, // Tracks local state overrides indexed by citizenID

  setAccountDisabledState: (citizenID, isDisabled) => {
    const actionTag = isDisabled 
      ? `ADMIN_DISABLE_${citizenID}` 
      : `ADMIN_ENABLE_${citizenID}`;

    console.log(`[Zustand Store] Executed Action Tag: ${actionTag}`);

    set((state) => ({
      disabledCitizens: {
        ...state.disabledCitizens,
        [citizenID]: isDisabled,
      },
      // Keep selected citizen in sync if currently displayed in the modal
      selectedCitizen: state.selectedCitizen && 
        (state.selectedCitizen.citizenID === citizenID || state.selectedCitizen.id === citizenID)
          ? {
              ...state.selectedCitizen,
              isDisabled,
              status: isDisabled ? 'Disabled' : 'Active',
            }
          : state.selectedCitizen,
    }));

    return actionTag;
  },

  getIsDisabled: (citizenID, fallbackValue) => {
    const storeState = get().disabledCitizens[citizenID];
    return storeState !== undefined ? storeState : fallbackValue;
  },

  // ── Modal State Management ──
  selectedCitizen: null,
  isModalOpen: false,

  openModal: (citizen) => set({ selectedCitizen: citizen, isModalOpen: true }),
  closeModal: () => set({ selectedCitizen: null, isModalOpen: false }),

  // ── Real-Time Socket Payload Merger ──
  updateLiveCitizen: (update) =>
    set((state) => {
      if (!state.selectedCitizen) return {};

      // Match incoming socket update against the active modal citizen
      const isTarget =
        state.selectedCitizen.id === update.id ||
        state.selectedCitizen.authUid === update.uid ||
        state.selectedCitizen.citizenID === update.citizenID;

      if (!isTarget) return {};

      return {
        selectedCitizen: {
          ...state.selectedCitizen,
          ...update,
        },
      };
    }),
}));