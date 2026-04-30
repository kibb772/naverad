'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function SignupPage() {
  const [form, setForm] = useState({ email: '', password: '', passwordConfirm: '', name: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.passwordConfirm) {
      setError('비밀번호가 일치하지 않습니다.');
      return;
    }

    if (form.password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, password: form.password, name: form.name, phone: form.phone }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || '회원가입에 실패했습니다.');
        return;
      }

      window.location.href = '/login?registered=true';
    } catch {
      setError('서버 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const passwordMismatch = form.passwordConfirm.length > 0 && form.password !== form.passwordConfirm;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 0' }}>
      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', marginBottom: '0.5rem' }}>
          🔥 열끈 광고 분석기
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.875rem' }}>
          AI 네이버 검색광고 분석 서비스
        </p>

        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1.5rem' }}>회원가입</h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="email" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>이메일</label>
            <input id="email" type="email" className="input" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required data-testid="signup-email-input" autoComplete="email" />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="password" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>비밀번호 (8자 이상)</label>
            <input id="password" type="password" className="input" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required data-testid="signup-password-input" autoComplete="new-password" />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="passwordConfirm" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>비밀번호 확인</label>
            <input id="passwordConfirm" type="password" className="input" value={form.passwordConfirm}
              onChange={(e) => setForm({ ...form, passwordConfirm: e.target.value })}
              required data-testid="signup-password-confirm-input" autoComplete="new-password"
              style={{ borderColor: passwordMismatch ? 'var(--danger)' : undefined }} />
            {passwordMismatch && (
              <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>비밀번호가 일치하지 않습니다.</p>
            )}
            {form.passwordConfirm.length > 0 && !passwordMismatch && (
              <p style={{ color: 'var(--success)', fontSize: '0.8125rem', marginTop: '0.25rem' }}>✓ 비밀번호가 일치합니다.</p>
            )}
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="name" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>이름</label>
            <input id="name" type="text" className="input" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required data-testid="signup-name-input" autoComplete="name" />
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="phone" style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>전화번호 (선택)</label>
            <input id="phone" type="text" className="input" value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              data-testid="signup-phone-input" autoComplete="tel" placeholder="010-0000-0000" />
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: '0.875rem', marginBottom: '1rem' }} role="alert">{error}</p>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }}
            disabled={loading || passwordMismatch} data-testid="signup-submit-button">
            {loading ? '가입 중...' : '회원가입'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          이미 계정이 있으신가요? <Link href="/login">로그인</Link>
        </p>
      </div>
    </div>
  );
}
