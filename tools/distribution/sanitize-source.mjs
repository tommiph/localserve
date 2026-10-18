/** Keep the public Oculus reading contract free of installation app aliases.
 * Rebuilding clean source is idempotent; unknown field shapes require review. */
export function sanitizeOculusReadings(source) {
  if (typeof source !== 'string') throw new TypeError('Expected Oculus source text.');
  const result = source.replace(
    /'active-app': pkg === '[^']+' \? 'Home VR'\s*:\s*/,
    "'active-app': ",
  );
  const fields = result.match(/'active-app'\s*:/g) || [];
  const genericField = /'active-app':\s*pkg\?\.startsWith\('com\.oculus\.'\)\s*\?\s*'Oculus system'\s*:\s*pkg\s*}/;
  if (fields.length !== 1 || !genericField.test(result)) {
    throw new Error('Review the public Oculus activity-reading contract before packaging.');
  }
  return result;
}

/** Source launchers initialize missing settings once, including after rebuilds. */
export function initializeSourceLauncher(source) {
  const start = 'start "" "tray\\LocalserveTray.exe"';
  const initialize = '"runtime\\node.exe" "tools\\initialize-settings.mjs"';
  if (typeof source !== 'string' || source.split(start).length !== 2) {
    throw new Error('Review the source launcher before packaging.');
  }
  const count = source.split(initialize).length - 1;
  if (count === 1 && source.indexOf(initialize) < source.indexOf(start)
    && source.slice(source.indexOf(initialize),source.indexOf(start)).includes('if errorlevel 1 exit /b 1')) return source;
  if (count !== 0) throw new Error('Source launcher initialization is ambiguous.');
  return source.replace(start,
    'rem Initialize missing private settings without replacing existing values.\r\n'
    + initialize + '\r\nif errorlevel 1 exit /b 1\r\n' + start);
}
