'use client';

import React from 'react';
import Link from 'next/link';

const EmergencyDebugLink = () => {
  return (
    <div style={{ 
      position: 'fixed', 
      top: '10px', 
      right: '10px', 
      zIndex: 9999, 
      background: 'red',
      padding: '10px',
      borderRadius: '5px'
    }}>
      <Link
        href="/debug"
        style={{
          color: 'white',
          fontWeight: 'bold',
          textDecoration: 'none',
          display: 'block'
        }}
      >
        EMERGENCY DEBUG MENU
      </Link>
    </div>
  );
};

export default EmergencyDebugLink;
