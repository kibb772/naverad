import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('유효한 이메일을 입력해주세요'),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다'),
  name: z.string().min(1, '이름을 입력해주세요').max(50),
  phone: z.string().regex(/^01[0-9]-?\d{3,4}-?\d{4}$/, '유효한 전화번호를 입력해주세요').optional().or(z.literal('')),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const naverAdsAccountSchema = z.object({
  apiKey: z.string().min(1, 'API Key를 입력해주세요'),
  secretKey: z.string().min(1, 'Secret Key를 입력해주세요'),
  customerId: z.string().min(1, 'Customer ID를 입력해주세요'),
});

export const campaignCreateSchema = z.object({
  name: z.string().min(1).max(100),
  dailyBudget: z.number().int().min(1000, '일예산은 최소 1,000원입니다'),
  campaignType: z.string().optional(),
});

export const bidAdjustSchema = z.object({
  keywordId: z.string().min(1),
  bidAmount: z.number().int().min(70, '최소 입찰가는 70원입니다'),
});

export const budgetAdjustSchema = z.object({
  campaignId: z.string().min(1),
  dailyBudget: z.number().int().min(1000),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type NaverAdsAccountInput = z.infer<typeof naverAdsAccountSchema>;
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type BidAdjustInput = z.infer<typeof bidAdjustSchema>;
export type BudgetAdjustInput = z.infer<typeof budgetAdjustSchema>;
