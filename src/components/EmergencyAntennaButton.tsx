'use client';

import React from 'react';

interface EmergencyAntennaButtonProps {}

const EmergencyAntennaButton: React.FC<EmergencyAntennaButtonProps> = () => {
  const forceAntennaPlacement = () => {
    try {
      // This is our emergency function that will force trigger antenna placement
      
      // First, alert that we're trying
      window.alert('Emergency antenna placement starting... This will place multiple antennas across the floorplan.');
      console.log('=============================================');
      console.log('EMERGENCY ANTENNA PLACEMENT STARTING');
      console.log('=============================================');
      
      // Step 1: Find the Auto Place button and click it directly
      const buttons = document.querySelectorAll('button');
      let found = false;
      
      buttons.forEach(button => {
        if (button.textContent?.trim() === 'Auto Place') {
          console.log('Found Auto Place button, clicking it directly');
          button.click();
          found = true;
        }
      });
      
      // If no button was found, try alternative method
      if (!found) {
        console.log('No button found, using direct method');
        // Directly place test antennas using our custom event
        const event = new CustomEvent('emergencyAntennaPlace', { 
          detail: { 
            forcePlace: true,
            count: 8, // Place 8 antennas
            spacing: 1.5 // Space them at 1.5x coverage radius
          } 
        });
        document.dispatchEvent(event);
        
        console.log('Emergency signal sent with custom placement parameters');
      }
    } catch (error: any) {
      console.error('Emergency antenna placement failed:', error);
      window.alert('Error: ' + (error.message || 'Unknown error'));
    }
  };

  return (
    <button
      onClick={forceAntennaPlacement}
      style={{
        position: 'fixed',
        left: '10px',
        top: '10px',
        background: 'red',
        color: 'white',
        padding: '8px 12px',
        fontWeight: 'bold',
        borderRadius: '4px',
        border: '2px solid white',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        zIndex: 9999
      }}
    >
      EMERGENCY ANTENNA TEST
    </button>
  );
};

export default EmergencyAntennaButton;
