import React from 'react';
import Agencies_Wrapper from '../dashboard_lastUtils/Agencies_Wrapper';

export default function Dashboard_LastSection({ reports }) {
  return (
    <div className="w-full flex flex-col gap-6">
      <Agencies_Wrapper reports={reports} />
    </div>
  );
}