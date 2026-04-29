/**
 * /api/rates — Vercel Serverless Function
 * Proxies Bank of Israel SDMX API to avoid browser CORS restrictions.
 *
 * GET /api/rates?currency=USD&startDate=2026-03-01&endDate=2026-04-28
 *
 * Returns: { currency: "USD", rates: [{ date: "2026-04-27", rate: 2.979 }, ...] }
 */

const BOI_BASE =
  'https://edge.boi.org.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/EXR/1.0';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { currency, startDate, endDate } = req.query;

  if (!currency || !startDate || !endDate) {
    return res.status(400).json({ error: 'Missing required params: currency, startDate, endDate' });
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return res.status(400).json({ error: 'Invalid currency code' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return res.status(400).json({ error: 'Dates must be YYYY-MM-DD' });
  }

  const url =
    `${BOI_BASE}/RER_${currency}_ILS` +
    `?startperiod=${startDate}&endperiod=${endDate}&format=sdmx-json&detail=dataonly`;

  let boiRes;
  try {
    boiRes = await fetch(url);
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach BOI API', detail: err.message });
  }

  if (!boiRes.ok) {
    const body = await boiRes.text().catch(() => '');
    return res.status(502).json({ error: `BOI API returned ${boiRes.status}`, detail: body.slice(0, 200) });
  }

  let json;
  try {
    json = await boiRes.json();
  } catch (err) {
    return res.status(502).json({ error: 'BOI API returned invalid JSON' });
  }

  try {
    const struct  = json.data.structure.dimensions.observation;
    const timeDim = struct.find(d => d.id === 'TIME_PERIOD' || d.role === 'time') || struct[0];
    const dates   = timeDim.values.map(v => v.id);

    const ds        = json.data.dataSets[0];
    const seriesKey = Object.keys(ds.series)[0];
    const obs       = ds.series[seriesKey].observations;

    const rates = Object.entries(obs)
      .map(([idx, vals]) => ({ date: dates[parseInt(idx)], rate: vals[0] }))
      .filter(r => r.date && r.rate != null)
      .sort((a, b) => a.date.localeCompare(b.date));

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json({ currency, rates });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to parse BOI SDMX response', detail: err.message });
  }
};
