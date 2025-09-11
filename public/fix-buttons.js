// Helper to directly modify the buttons in the DOM to enable them
// This is a workaround for when direct code changes are difficult

document.addEventListener('DOMContentLoaded', () => {
  setInterval(() => {
    // Find all auto place buttons
    const buttons = document.querySelectorAll('button');
    
    buttons.forEach(button => {
      if (button.textContent?.trim() === 'Auto Place') {
        // Enable the button
        button.disabled = false;
        
        // Check if the button already has our custom click handler
        if (!button.hasAttribute('data-fixed')) {
          // Save the original click handler
          const originalClick = button.onclick;
          
          // Add our own click handler
          button.onclick = (event) => {
            console.log('Auto Place button clicked - using modified handler');
            
            // Call the original handler
            if (originalClick) {
              return originalClick.call(button, event);
            }
          };
          
          // Mark this button as fixed
          button.setAttribute('data-fixed', 'true');
          
          console.log('Auto Place button fixed');
        }
      }
    });
  }, 1000);  // Check every second
});
