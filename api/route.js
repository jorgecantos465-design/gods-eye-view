import { rehydrateBody, resolveRequestUrl } from '../server/vercel/adapter.js';
import { getVercelApi } from '../server/vercel/app.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  req.url = resolveRequestUrl(req);
  rehydrateBody(req);
  const api = await getVercelApi();
  await api.handle(req, res);
}
