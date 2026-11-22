import { readFileSync } from 'node:fs';
import { RunRequestSchema } from '@interface-ai/contracts';
import type { RunRequest } from '@interface-ai/contracts';

// Explicit caller examples. The worker never imports these presets.
function discoveryRequest(file: string): Extract<RunRequest,{mode:'discovery'}> {
  const request=RunRequestSchema.parse(JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8')));
  if(request.mode!=='discovery')throw new Error('Expected a discovery example.');
  return request;
}
export const currentBalanceRequest=discoveryRequest('./discovery-current.json');
export const availableBalanceRequest=discoveryRequest('./discovery-available.json');
