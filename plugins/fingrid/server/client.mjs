/** Fixed Fingrid Open Data reads. Credentials are headers, never URL content. */
export const validDatasetId = value => typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2147483647;
export const validKey = value => typeof value === 'string' && /^[a-fA-F0-9]{16,128}$/.test(value);
export const text = (value, limit = 240) => typeof value === 'string' && value.trim()
  ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, limit) : null;
export function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

export function mapMetadata(data, id, language = 'en') {
  if (!data || data.id !== Number(id) || data.type !== 'timeseries') {
    throw new Error('Fingrid did not return the requested time-series dataset.');
  }
  const suffix = language === 'fi' ? 'Fi' : 'En';
  const title = text(data['name' + suffix]);
  if (!title) throw new Error('Fingrid returned missing dataset metadata.');
  return {
    'dataset-title': title, description: text(data['description' + suffix], 1600),
    unit: text(data['unit' + suffix], 64), 'data-period': text(data['dataPeriod' + suffix], 80),
    'update-cadence': text(data['updateCadence' + suffix], 80), 'dataset-status': text(data.status, 40),
    organization: text(data.organization, 100), license: text(data.license?.name, 100),
    'dataset-url': `https://data.fingrid.fi/${language === 'fi' ? '' : 'en/'}datasets/${id}`,
  };
}

export function mapLatest(data, id) {
  const start = timestamp(data?.startTime), end = timestamp(data?.endTime);
  if (!data || data.datasetId !== Number(id) || typeof data.value !== 'number' || !Number.isFinite(data.value)
    || start === null || end === null || end < start) {
    throw new Error('Fingrid returned an invalid reading or unexpected dataset identity.');
  }
  // Future intervals are valid for forecast datasets. Display the reported
  // period without inventing an observation time, freshness or measured state.
  return { value: data.value, 'period-start': start, 'period-end': end, 'modified-at': timestamp(data.modifiedAtUtc) };
}

export function createClient(fetchImpl = (...args) => fetch(...args)) {
  return {
    async read(id, kind, key, signal) {
      if (!validDatasetId(id) || !validKey(key) || !['metadata', 'latest'].includes(kind)) throw new Error('Configure a valid Fingrid key and dataset ID.');
      const url = `https://data.fingrid.fi/api/datasets/${id}${kind === 'latest' ? '/data/latest' : ''}`;
      let response;
      try {
        response = await fetchImpl(url, { headers: { Accept: 'application/json', 'x-api-key': key }, redirect: 'manual', signal });
        signal.throwIfAborted();
        if (response.status !== 200) {
          await response.body?.cancel();
          const error = new Error(`Fingrid request failed (HTTP ${response.status}).`);
          error.status = response.status;
          const seconds = response.headers.get('retry-after');
          error.retryMs = /^\d{1,6}$/.test(seconds || '') ? Math.min(86400000, Number(seconds) * 1000) : null;
          throw error;
        }
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || !response.body) {
          await response.body?.cancel(); throw new Error('Fingrid returned an unsupported response.');
        }
        const reader = response.body.getReader(), chunks = [];
        let length = 0, complete = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            signal.throwIfAborted();
            if (done) { complete = true; break; }
            length += value.byteLength;
            if (length > 512 * 1024) throw new Error('Fingrid response exceeds 512 KiB.');
            chunks.push(value);
          }
          try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
          catch { throw new Error('Fingrid returned invalid UTF-8 JSON.'); }
        } finally {
          if (!complete) await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch (error) {
        signal.throwIfAborted();
        // Network/provider messages can echo request headers. Only our fixed
        // errors and status categories cross into plugin logs or public fields.
        if (/^Fingrid (request failed \(HTTP \d{3}\)\.|returned (an unsupported response\.|invalid UTF-8 JSON\.)|response exceeds 512 KiB\.)$/.test(error.message)) throw error;
        throw new Error('Fingrid connection failed. Previous readings retained.');
      }
    },
  };
}
