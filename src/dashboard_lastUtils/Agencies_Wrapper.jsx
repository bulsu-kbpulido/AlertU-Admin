import React, { useState } from 'react';
import Agencies_Charts from './Agencies_Charts';
import Agencies_RankingTable from './Agencies_RankingTable';

export default function Agencies_Wrapper({ reports }) {
  // Shared month state across both Agency charts & ranking table
  const [monthlyDateValue, setMonthlyDateValue] = useState(new Date());

  return (
    <div className="flex flex-col gap-6 w-full">
      
      {/* TOP: Main Chart Slot */}
      <div className="w-full">
        <Agencies_Charts 
          reports={reports} 
          monthlyDateValue={monthlyDateValue}
          onMonthChange={setMonthlyDateValue}
        />
      </div>

      {/* BOTTOM: Ranking Table Slot */}
      <div className="w-full">
        <Agencies_RankingTable 
          monthlyDateValue={monthlyDateValue} 
          onMonthChange={setMonthlyDateValue}
        />
      </div>

    </div>
  );
}