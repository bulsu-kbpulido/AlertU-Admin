import React from 'react';
import Citizen_Charts from './Citizen_Charts';

export default function Agencies_Wrapper({ reports }) {
  return (
    <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch mb-6">

      {/* Full-width desktop partition slot */}
      <div className="w-full lg:col-span-12 flex">
        <Citizen_Charts reports={reports} />        
      </div>

    </div>
  );
}