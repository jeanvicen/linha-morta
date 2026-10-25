/** Official credits, exactly as supplied by the creator. Do not add collaborators or sponsors. */
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from './ideas/ideas';

export interface CreditEntry {
  role: string;
  name: string;
  href?: string;
}

export const CREDITS: readonly CreditEntry[] = [
  { role: 'CRIADOR', name: 'Jean Carlos de Souza Vicen' },
  { role: 'PROGRAMAÇÃO', name: 'jeanvicen' },
  { role: 'DESIGN', name: 'jeanvicen' },
  { role: 'HISTÓRIA', name: 'jeanvicen' },
  { role: 'INSTAGRAM', name: INSTAGRAM_HANDLE, href: INSTAGRAM_URL },
];
