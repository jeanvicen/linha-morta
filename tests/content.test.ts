import { describe, expect, it } from 'vitest';
import { DONATION_MESSAGE, DONATION_STEPS, DONATION_TITLE, PIX_KEY } from '../src/features/donation/pix';
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from '../src/features/ideas/ideas';
import { CREDITS } from '../src/features/credits';

describe('official content', () => {
  it('uses the PIX key supplied by the creator', () => {
    expect(PIX_KEY).toBe('cb82924d-0665-42f5-963a-8a720f8e6302');
    expect(DONATION_TITLE).toBe('APOIE LINHA MORTA');
    expect(DONATION_MESSAGE).toBe(
      'LINHA MORTA é um projeto em desenvolvimento. Sua contribuição ajuda a financiar novas áreas, melhorias visuais, sistemas de jogo e futuras histórias. Qualquer valor é voluntário e você pode continuar jogando sem doar.',
    );
    expect(DONATION_STEPS).toHaveLength(5);
  });

  it('uses the official Instagram', () => {
    expect(INSTAGRAM_HANDLE).toBe('@0neajx');
    expect(INSTAGRAM_URL).toBe('https://www.instagram.com/0neajx/');
  });

  it('shows exactly the supplied credits', () => {
    expect(CREDITS).toEqual([
      { role: 'CRIADOR', name: 'Jean Carlos de Souza Vicen' },
      { role: 'PROGRAMAÇÃO', name: 'jeanvicen' },
      { role: 'DESIGN', name: 'jeanvicen' },
      { role: 'HISTÓRIA', name: 'jeanvicen' },
      { role: 'INSTAGRAM', name: '@0neajx', href: 'https://www.instagram.com/0neajx/' },
    ]);
  });
});
