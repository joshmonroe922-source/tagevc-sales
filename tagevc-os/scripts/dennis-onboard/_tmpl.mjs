import { sb } from './lib.mjs';
const r = await sb('os_hris_process_templates?select=slug,kind,title,audience,active&order=slug.asc');
console.log(JSON.stringify(r.body, null, 1));
