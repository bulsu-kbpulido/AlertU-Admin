import React, { createContext, useState } from 'react';

export const IncidentContext = createContext();

export const IncidentProvider = ({ children }) => {
  const [activeIncident, setActiveIncident] = useState(null);

  return (
    <IncidentContext.Provider value={{ activeIncident, setActiveIncident }}>
      {children}
    </IncidentContext.Provider>
  );
};