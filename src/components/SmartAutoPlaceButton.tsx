'use client';

import React from 'react';

interface SmartAutoPlaceButtonProps {
  onClick: () => void;
  perimeter: any[] | null;
  savedAreas: any[];
  objects: any[];
  selection: any[] | null;
  scale: number | null;
  className?: string;
  text?: string;
}

const SmartAutoPlaceButton: React.FC<SmartAutoPlaceButtonProps> = ({ 
  onClick, 
  perimeter, 
  savedAreas, 
  objects,
  selection,
  scale,
  className = "px-3 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50",
  text = "Auto Place"
}) => {
  // Check if we have any valid areas to place antennas
  const hasPerimeter = perimeter && perimeter.length >= 3;
  const hasSelection = selection && selection.length >= 3;
  const hasAreas = savedAreas.length > 0;
  const hasObjects = objects.length > 0;
  
  const hasValidAreas = hasPerimeter || hasAreas || hasObjects || hasSelection;
  
  // Button should be disabled if we have no valid areas or no scale
  const isDisabled = !hasValidAreas || !scale;
  
  const handleClick = () => {
    console.log('Smart Auto Place clicked', {
      hasPerimeter,
      hasSelection,
      hasAreas,
      hasObjects,
      hasValidAreas,
      scale
    });
    
    if (!isDisabled) {
      onClick();
    }
  };
  
  return (
    <button 
      onClick={handleClick}
      disabled={isDisabled}
      className={className}
    >
      {text}
    </button>
  );
};

export default SmartAutoPlaceButton;
