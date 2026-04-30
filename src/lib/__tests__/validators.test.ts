import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  signupSchema,
  loginSchema,
  campaignCreateSchema,
  bidAdjustSchema,
  budgetAdjustSchema,
} from '../validators';

describe('signupSchema', () => {
  it('validates correct input', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: 'password123',
      name: '홍길동',
      phone: '010-1234-5678',
    });
    expect(result.success).toBe(true);
  });

  it('rejects short password', () => {
    const result = signupSchema.safeParse({
      email: 'test@example.com',
      password: '1234567',
      name: '홍길동',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = signupSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
      name: '홍길동',
    });
    expect(result.success).toBe(false);
  });

  it('PBT: round-trip - valid signup data always parses successfully', () => {
    const alphaNum = fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/);
    const domain = fc.stringMatching(/^[a-z]{2,6}$/);
    const tld = fc.constantFrom('com', 'net', 'org', 'io', 'kr');
    const validEmail = fc.tuple(alphaNum, domain, tld).map(([u, d, t]) => `${u}@${d}.${t}`);

    const validSignup = fc.record({
      email: validEmail,
      password: fc.string({ minLength: 8, maxLength: 100 }),
      name: fc.stringMatching(/^[가-힣a-zA-Z]{1,10}$/),
    });

    fc.assert(
      fc.property(validSignup, (data) => {
        const result = signupSchema.safeParse(data);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.email).toBe(data.email);
          expect(result.data.password).toBe(data.password);
          expect(result.data.name).toBe(data.name);
        }
      })
    );
  });
});

describe('loginSchema', () => {
  it('validates correct input', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });

  it('rejects empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
});

describe('campaignCreateSchema', () => {
  it('validates correct input', () => {
    const result = campaignCreateSchema.safeParse({ name: '봄 프로모션', dailyBudget: 50000 });
    expect(result.success).toBe(true);
  });

  it('rejects budget below minimum', () => {
    const result = campaignCreateSchema.safeParse({ name: '테스트', dailyBudget: 500 });
    expect(result.success).toBe(false);
  });

  it('PBT: valid budgets always pass', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1000, max: 100000000 }),
        (name, budget) => {
          const result = campaignCreateSchema.safeParse({ name, dailyBudget: budget });
          expect(result.success).toBe(true);
        }
      )
    );
  });
});

describe('bidAdjustSchema', () => {
  it('rejects bid below 70', () => {
    expect(bidAdjustSchema.safeParse({ keywordId: 'k1', bidAmount: 50 }).success).toBe(false);
  });

  it('PBT: valid bids always pass', () => {
    fc.assert(
      fc.property(fc.integer({ min: 70, max: 100000 }), (bid) => {
        const result = bidAdjustSchema.safeParse({ keywordId: 'test-id', bidAmount: bid });
        expect(result.success).toBe(true);
      })
    );
  });
});

describe('budgetAdjustSchema', () => {
  it('PBT: valid budgets always pass', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 100000000 }), (budget) => {
        const result = budgetAdjustSchema.safeParse({ campaignId: 'test-id', dailyBudget: budget });
        expect(result.success).toBe(true);
      })
    );
  });
});
