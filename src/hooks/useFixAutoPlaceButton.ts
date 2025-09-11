'use client';

import { useEffect } from 'react';

// This hook will fix the Auto Place button by monitoring the DOM
// and enabling the button when it finds it
export function useFixAutoPlaceButton() {
  useEffect(() => {
    const fixButtons = () => {
      // Find all buttons with text "Auto Place"
      const buttons = document.querySelectorAll('button');
      
      buttons.forEach(button => {
        if (button.textContent?.trim() === 'Auto Place') {
          // Enable the button by removing the disabled attribute
          button.disabled = false;
          
          console.log('Auto Place button found and enabled');
        }
      });
    };

    // Run once on mount
    setTimeout(fixButtons, 500);
    
    // Then set up an interval to check periodically
    const intervalId = setInterval(fixButtons, 1000);
    
    // Clean up
    return () => clearInterval(intervalId);
  }, []);
}

export default useFixAutoPlaceButton;
