// Guard script: remove shadowing compiled JS that conflicts with TS source
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'src', 'utils', 'antennaUtils.js');
try {
  if (fs.existsSync(target)) {
    const content = fs.readFileSync(target, 'utf8');
    if (/Bridge file/.test(content) || content.trim().startsWith('//')) {
      fs.unlinkSync(target);
      console.log('[prebuild-clean] Removed shadowing antennaUtils.js');
    }
  }
} catch (e) {
  console.warn('[prebuild-clean] Error cleaning shadow file:', e.message);
}
