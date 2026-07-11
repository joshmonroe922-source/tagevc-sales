export const TAGEVC_BRAND = {
  name: 'Tage Venture Capital',
  shortName: 'Tage VC',
  website: 'https://tagevc.com',
  colors: {
    primary: '#1a3a2f',
    accent: '#8b6914',
  },
  voice: [
    'Professional and direct',
    'Operator-first, not hype-driven',
    'Clear about Launch, Partner, and Exit paths',
  ],
  hashtags: ['#TageVC', '#VentureCapital', '#Founders', '#Launch', '#Exit'],
} as const;

export type DealPathTopic = 'launch' | 'partner' | 'exit' | 'general';

export const DEAL_PATH_TOPICS: Record<DealPathTopic, string> = {
  launch: 'Launch — venture studio support for new founders',
  partner: 'Partner — strategic partnerships for growth-stage companies',
  exit: 'Exit — confidential planning for business transitions',
  general: 'General thought leadership for Tage Venture Capital',
};
