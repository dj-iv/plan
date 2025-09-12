// Test the AI Scale Detector functionality
import { AIScaleDetector } from '../src/lib/ai-scale-detector';

async function testAIScaleDetector() {
  console.log('Testing AI Scale Detector...');
  
  // Mock image data URL (you would replace this with an actual floorplan image)
  const mockImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  
  try {
    const detector = new AIScaleDetector();
    const results = await detector.detectScale(mockImageDataUrl);
    
    console.log('Scale Detection Results:');
    console.log('Number of results:', results.length);
    
    results.forEach((result, index) => {
      console.log(`\nResult ${index + 1}:`);
      console.log('- Scale:', result.scale);
      console.log('- Unit:', result.unit);
      console.log('- Confidence:', Math.round(result.confidence * 100) + '%');
      console.log('- Method:', result.method);
      console.log('- Source:', result.source);
    });
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test
testAIScaleDetector();
