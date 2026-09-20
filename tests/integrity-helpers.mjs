import { readFileSync } from 'node:fs';
export const fixture = name => readFileSync(new URL('./fixtures/' + name, import.meta.url));
export const receipt = () => JSON.parse(fixture('profile-receipt.json'));
export const outcome = () => JSON.parse(fixture('profile-outcome.json'));
export const bytes = value => Buffer.from(JSON.stringify(value));
