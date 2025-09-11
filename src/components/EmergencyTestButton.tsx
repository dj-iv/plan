'use client';

import React from 'react';

interface EmergencyTestButtonProps {
  onClick: () => void;
}

const EmergencyTestButton: React.FC<EmergencyTestButtonProps> = ({ onClick }) => {
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
      <button
        onClick={onClick}
        style={{
          color: 'white',
          fontWeight: 'bold',
          border: 'none',
          background: 'none',
          cursor: 'pointer'
        }}
      >
        EMERGENCY TEST BUTTON
      </button>
    </div>
  );
};

export default EmergencyTestButton;
