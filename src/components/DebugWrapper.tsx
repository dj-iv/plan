'use client';

import React, { useEffect } from 'react';
import EmergencyDebugLink from './EmergencyDebugLink';

// Simple wrapper component to add an emergency debug link to any existing component
const DebugWrapper: React.FC<{children: React.ReactNode}> = ({ children }) => {
  // Log to console when mounted - helpful for debugging
  useEffect(() => {
    console.log('DebugWrapper mounted - debug tools available');
  }, []);

  return (
    <>
      {children}
      <EmergencyDebugLink />
    </>
  );
};

export default DebugWrapper;
