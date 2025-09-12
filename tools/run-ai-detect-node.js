(async ()=>{
  const { AIScaleDetector } = require('../src/lib/ai-scale-detector');
  const path = process.argv[2];
  if (!path) { console.error('Usage: node run-ai-detect-node.js <image>'); process.exit(2); }
  const det = new AIScaleDetector();
  console.log('Running AIScaleDetector.detectScale on', path);
  const res = await det.detectScale(path);
  console.log('Results:', JSON.stringify(res, null, 2));
})();
