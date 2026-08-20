import React, { useState } from 'react';
import Login from 'pages/Login'; // Adjust path to your Login component

export default function LoginWrapper() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('authToken'));

  const handleLoginSuccess = (adminData) => {
    // 1. Save the token immediately
    localStorage.setItem('authToken', adminData.token);
    
    // 2. Update state to trigger UI changes (like redirecting to dashboard)
    setIsAuthenticated(true);
    
    console.log('✅ Auth success: Token stored and state updated.');
  };

  if (isAuthenticated) {
    return <div>Redirecting to Dashboard...</div>;
  }

  return (
    <Login onLoginSuccess={handleLoginSuccess} />
  );
}