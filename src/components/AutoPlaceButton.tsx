import React from 'react';

interface AutoPlaceButtonProps {
  onClick: () => void;
  perimeter: any;
  savedAreas: any[];
  objects: any[];
  scale: number | null;
}

const AutoPlaceButton: React.FC<AutoPlaceButtonProps> = ({ 
  onClick, 
  perimeter, 
  savedAreas, 
  objects, 
  scale
}) => {
  // Check if we have valid areas to place antennas
  const hasValidAreas = (perimeter && perimeter.length >= 3) || 
                        savedAreas.length > 0 || 
                        objects.length > 0;
  
  // Button should be disabled if we have no valid areas or no scale
  const isDisabled = !hasValidAreas || !scale;
  
  return (
    <button 
      onClick={onClick}
      disabled={isDisabled}
      className="px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
    >
      Auto Place
    </button>
  );
};

export default AutoPlaceButton;
