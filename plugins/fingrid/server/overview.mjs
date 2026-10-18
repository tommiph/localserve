/** Fixed Finland overview fields reuse already collected named datasets.
 * No extra requests, inferred percentages, calculated generation or forecasts.
 */
export const overviewMetrics = [
  { id: 'production', dataset: '192', label: 'Production', unit: 'MW' },
  { id: 'consumption', dataset: '193', label: 'Consumption', unit: 'MW' },
  { id: 'wind', dataset: '181', label: 'Wind production', unit: 'MW' },
  { id: 'frequency', dataset: '177', label: 'Frequency', unit: 'Hz' },
  { id: 'nuclear', dataset: '188', label: 'Nuclear production', unit: 'MW' },
  { id: 'hydro', dataset: '191', label: 'Hydro production', unit: 'MW' },
  { id: 'carbon', dataset: '265', label: 'CO₂ estimate', unit: 'gCO2/kWh' },
];

export function overviewValues(settings, state) {
  const values = {}, periods = [], receipts = [];
  for (const metric of overviewMetrics) {
    const source = settings.datasets.find(item => item.enabled && item.query === metric.dataset);
    const reading = source && state.datasets?.[source.id];
    // Changed/disabled/missing sources cannot feed their old cached target into
    // the overview. Unknown units are not converted or guessed.
    const known = reading?.query === metric.dataset && Number.isFinite(reading.value)
      && reading.unit === metric.unit && Number.isFinite(reading['period-end']) && Number.isFinite(reading['received-at']);
    values[`grid-${metric.id}`] = known ? reading.value : null;
    values[`grid-${metric.id}-unit`] = known ? reading.unit : null;
    if (known) { periods.push(reading['period-end']); receipts.push(reading['received-at']); }
  }
  // These labels describe the oldest reported times among displayed known
  // values, without implying synchronized measurements or inferred freshness.
  values['grid-period-end'] = periods.length ? Math.min(...periods) : null;
  values['grid-received-at'] = receipts.length ? Math.min(...receipts) : null;
  return values;
}
