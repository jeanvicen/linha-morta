/**
 * PIX donation data supplied by the creator. No payment is simulated or confirmed by the game:
 * the player completes any transfer inside their own banking app.
 *
 * A payment QR code is intentionally NOT generated: a valid PIX "BR Code" payload also requires
 * the verified merchant name and city, which were not provided. Showing a QR with only the key
 * would be an invalid payment code.
 */
export const PIX_KEY = 'cb82924d-0665-42f5-963a-8a720f8e6302';
export const PIX_KEY_TYPE = 'Chave aleatória';

export const DONATION_TITLE = 'APOIE LINHA MORTA';
export const DONATION_MESSAGE =
  'LINHA MORTA é um projeto em desenvolvimento. Sua contribuição ajuda a financiar novas áreas, melhorias visuais, sistemas de jogo e futuras histórias. Qualquer valor é voluntário e você pode continuar jogando sem doar.';

export const DONATION_STEPS: readonly string[] = [
  'Copie a chave PIX.',
  'Abra o aplicativo do seu banco.',
  'Escolha a opção de transferência PIX.',
  'Informe ou cole a chave e confira os dados do destinatário antes de confirmar.',
  'Escolha o valor voluntário e confirme no banco.',
];
